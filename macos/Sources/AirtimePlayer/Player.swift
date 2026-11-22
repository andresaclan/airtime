import AVFoundation
import AirtimeKit
import CoreMedia
import Foundation
import ImageIO
import Observation

/// What opening a video found out about it.
public struct VideoInfo: Sendable {
	public var url: URL
	public var timing: Timing
	public var frameRateSource: FrameRateSource
	public var variableFrameRate: Bool
	public var duration: Double
	/// The picture as displayed: rotation applied.
	public var displaySize: CGSize
	public var fileSize: Double
	public var lastModified: Date
	/// When the camera says it was filmed (QuickTime creation date), if the file has one.
	public var creationDate: Date?
	public var mimeType: String
	public var hasAudio: Bool
}

public enum OpenError: LocalizedError {
	case unplayable(String)
	case noVideo(String)
	case noFrameTimes(String)
	public var errorDescription: String? {
		switch self {
		case .unplayable(let name): "Unable to play \(name). The video may be unsupported or damaged."
		case .noVideo(let name): "\(name) has no video track."
		case .noFrameTimes(let name): "The frame times of \(name) couldn't be read, so its frames can't be marked. If it's a screen recording or an edit, export it again (QuickTime Player: File › Export As)."
		}
	}
}

/// One video, played and stepped with AVFoundation.
///
/// Every frame shown while paused is the result of an exact seek (zero tolerance either side)
/// to the middle of a frame in the file's own frame table, so the picture is always the frame
/// Airtime records, including variable frame rate and slow-motion pre-rolls.
///
/// Steps and scrubs never queue up: while a seek is decoding, new requests only replace its
/// successor ("chase" seeking, as in Apple's QA1820), so holding a step key or dragging the
/// timeline always lands on the latest target without a backlog.
///
/// Times outside this class are canonical media time, the timeline the web app stores marks on.
/// AVFoundation keeps the gap before a partial-frame edit's first complete frame (as Safari
/// does), so native time = canonical time + `editGap`.
@MainActor @Observable
public final class VideoPlayer {
	/// The largest move, in frames, made by stepping rather than seeking.
	let maxStep = 12
	public let player = AVPlayer()
	public private(set) var info: VideoInfo?
	/// The frame on screen, or being sought to. Steps move from here.
	public private(set) var frame = 0
	/// The frame the last finished seek presented; differs from `frame` while a seek decodes.
	public private(set) var presentedFrame = 0
	/// Canonical media time of the playhead, updated during playback.
	public private(set) var time = 0.0
	public private(set) var isPlaying = false
	public private(set) var isSeeking = false
	/// Playback speed: a viewing aid only.
	public var speed: Float = 1 {
		didSet { if isPlaying { player.rate = speed } }
	}
	public var volume: Float = 1 { didSet { player.volume = volume } }
	public var isMuted = false { didSet { player.isMuted = isMuted } }

	/// A small picture of the target frame, shown over the video while an exact seek to a far
	/// frame decodes (timeline drags, jumps to marks). Nil once the real frame is on screen.
	public private(set) var preview: CGImage?
	public private(set) var scrubCache: ScrubCache?
	@ObservationIgnored private var previewClear: Task<Void, Never>?

	/// Frame and time readback for the decoded-frame checker.
	public private(set) var videoOutput: AVPlayerItemVideoOutput?

	@ObservationIgnored private var timeObserver: Any?
	@ObservationIgnored private var endObserver: NSObjectProtocol?
	@ObservationIgnored private var seekInFlight = false
	@ObservationIgnored private var pendingFrame: Int?
	@ObservationIgnored private var seekWaiters: [CheckedContinuation<Void, Never>] = []
	/// Frames that must be shown before any later target, in order (a mark's frame), with who
	/// is waiting for each.
	@ObservationIgnored private var stops: [(token: Int, frame: Int)] = []
	@ObservationIgnored private var stopWaiters: [Int: CheckedContinuation<Bool, Never>] = [:]
	@ObservationIgnored private var stopResults: [Int: Bool] = [:]
	@ObservationIgnored private var stopCount = 0
	/// Called as each frame is presented, before the next move starts (for frame-check).
	@ObservationIgnored public var onPresent: ((Int) -> Void)?
	@ObservationIgnored private var generation = 0

	public init() {
		player.actionAtItemEnd = .pause
		player.automaticallyWaitsToMinimizeStalling = false
		// Exact seeks are what stepping is for; nothing should snap them to keyframes.
		player.preventsDisplaySleepDuringVideoPlayback = true
	}

	public var timing: Timing? { info?.timing }
	public var lastFrame: Int { info.map { $0.timing.lastFrame(duration: $0.duration) } ?? 0 }

	// MARK: Opening

	public func open(_ url: URL, readback: Bool = false) async throws -> VideoInfo {
		close()
		generation += 1
		let generation = self.generation
		let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
		let name = url.lastPathComponent
		guard try await asset.load(.isPlayable) else { throw OpenError.unplayable(name) }
		guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw OpenError.noVideo(name) }
		let (natural, transform, nominal) = try await track.load(.naturalSize, .preferredTransform, .nominalFrameRate)
		let duration = try await asset.load(.duration).seconds
		let hasAudio = !(try await asset.loadTracks(withMediaType: .audio)).isEmpty
		var creationDate: Date?
		if let item = try? await asset.load(.creationDate) { creationDate = try? await item.load(.dateValue) }
		let rect = CGRect(origin: .zero, size: natural).applying(transform)
		let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .typeIdentifierKey])

		_ = nominal
		// The file's own sample tables, or no marking: Airtime won't guess frame times. That
		// includes fragmented MP4s, where AVFoundation's seeks themselves were seen to show
		// the wrong picture (frame-check --as on remuxed fixtures).
		guard let parsed = VideoTiming.detect(url) else { throw OpenError.noFrameTimes(name) }
		let timing = parsed.timing
		let source = FrameRateSource.container
		guard generation == self.generation else { throw CancellationError() }

		let item = AVPlayerItem(asset: asset)
		if readback {
			let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
			item.add(output)
			videoOutput = output
		}
		player.replaceCurrentItem(with: item)
		player.volume = volume
		player.isMuted = isMuted
		info = VideoInfo(
			url: url, timing: timing, frameRateSource: source, variableFrameRate: parsed.analysis.variableFrameRate,
			duration: duration.isFinite ? duration : 0, displaySize: CGSize(width: abs(rect.width), height: abs(rect.height)),
			fileSize: Double(values?.fileSize ?? 0), lastModified: values?.contentModificationDate ?? Date(),
			creationDate: creationDate, mimeType: mimeType(url), hasAudio: hasAudio)
		observe()
		scrubCache = ScrubCache.build(url: url, timing: timing)
		let opened = info!
		while item.status == .unknown, generation == self.generation { try await Task.sleep(for: .milliseconds(5)) }
		guard generation == self.generation else { throw CancellationError() }
		if item.status == .failed { throw OpenError.unplayable(name) }
		frame = 0
		presentedFrame = -1
		await seek(toFrame: 0)
		guard generation == self.generation else { throw CancellationError() }
		return opened
	}

	public func close() {
		generation += 1
		pause()
		if let timeObserver { player.removeTimeObserver(timeObserver) }
		if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
		timeObserver = nil
		endObserver = nil
		player.replaceCurrentItem(with: nil)
		info = nil
		videoOutput = nil
		scrubCache?.cancel()
		scrubCache = nil
		preview = nil
		pendingFrame = nil
		seekInFlight = false
		isSeeking = false
		let waiters = seekWaiters
		seekWaiters = []
		for waiter in waiters { waiter.resume() }
		resumeStops(nil)
		frame = 0
		presentedFrame = 0
		time = 0
	}

	/// Makes `target` a stop: it's shown before anything asked for after it, so a mark's frame
	/// is always one the athlete saw, even when more steps follow before the decoder catches
	/// up. Registered at once, when the mark is asked for; `waitForStop` then waits for it.
	public func addStop(_ target: Int) -> Int {
		stopCount += 1
		let token = stopCount
		if info == nil {
			stopResults[token] = false
		} else if presentedFrame == target, !seekInFlight, pendingFrame == nil, stops.isEmpty {
			stopResults[token] = true
		} else {
			stops.append((token, target))
			if !seekInFlight { requestSeek(target) }
		}
		return token
	}

	/// True once the stop's frame has been presented; false if the video closed first.
	public func waitForStop(_ token: Int) async -> Bool {
		if let result = stopResults.removeValue(forKey: token) { return result }
		return await withCheckedContinuation { stopWaiters[token] = $0 }
	}

	public func present(_ target: Int) async -> Bool { await waitForStop(addStop(target)) }

	/// Settles the stops at the front of the queue that are on `frame` (in order: a later stop on
	/// the same frame waits for the ones before it), or every stop when nil (closing).
	private func resumeStops(_ frame: Int?) {
		let count = frame.map { f in stops.prefix { $0.frame == f }.count } ?? stops.count
		let done = Array(stops.prefix(count))
		stops.removeFirst(count)
		for stop in done {
			if let waiter = stopWaiters.removeValue(forKey: stop.token) { waiter.resume(returning: frame != nil) } else { stopResults[stop.token] = frame != nil }
		}
		if frame == nil {
			for (_, waiter) in stopWaiters { waiter.resume(returning: false) }
			stopWaiters = [:]
		}
	}

	private func observe() {
		let interval = CMTime(value: 1, timescale: 120)
		timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] native in
			MainActor.assumeIsolated {
				guard let self, self.isPlaying, let timing = self.timing else { return }
				self.time = self.canonical(native.seconds)
				self.frame = timing.frame(at: self.time)
				self.presentedFrame = self.frame
			}
		}
		endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: player.currentItem, queue: .main) { [weak self] _ in
			MainActor.assumeIsolated { self?.finishPlaying() }
		}
	}

	private func canonical(_ native: Double) -> Double { native - (info?.timing.editGap ?? 0) }
	private func native(_ canonical: Double) -> Double { canonical + (info?.timing.editGap ?? 0) }

	// MARK: Playback

	/// Bumped by every play and pause, so a play still waiting on a seek can be called off.
	@ObservationIgnored private var playRequest = 0
	/// A play waiting for the latest seek before it starts.
	public private(set) var playPending = false

	public func play() {
		guard info != nil, !isPlaying, !playPending else { return }
		playRequest += 1
		let request = playRequest
		playPending = true
		Task {
			// Start from the latest target the playhead was asked for, on its real picture.
			await settled()
			if frame >= lastFrame, request == playRequest { await seek(toFrame: 0) }
			guard request == playRequest else { return }
			playPending = false
			guard info != nil, !isPlaying else { return }
			startPlaying()
		}
	}

	private func startPlaying() {
		previewClear?.cancel()
		preview = nil
		isPlaying = true
		player.rate = speed
	}

	public func pause() {
		playRequest += 1
		playPending = false
		guard isPlaying else { return }
		isPlaying = false
		player.pause()
		snapToFrame()
	}

	public func togglePlay() { isPlaying || playPending ? pause() : play() }

	private func finishPlaying() {
		isPlaying = false
		player.pause()
		Task { await seek(toFrame: lastFrame) }
	}

	/// After a pause the playhead sits somewhere inside a frame; settle on that frame's middle so
	/// the readout, the picture and a mark placed now agree.
	private func snapToFrame() {
		guard let timing else { return }
		let now = canonical(player.currentTime().seconds)
		frame = timing.clamp(timing.frame(at: now), duration: info?.duration ?? .infinity)
		requestSeek(frame)
	}

	// MARK: Stepping and seeking

	public func step(_ count: Int) {
		guard info != nil else { return }
		if isPlaying {
			isPlaying = false
			player.pause()
			if let timing { frame = timing.frame(at: canonical(player.currentTime().seconds)) }
		}
		frame = max(0, min(lastFrame, frame + count))
		requestSeek(frame)
	}

	/// Shows frame `target` exactly. Returns once it, or a later target, is presented.
	public func seek(toFrame target: Int) async {
		guard info != nil else { return }
		if isPlaying {
			isPlaying = false
			player.pause()
		}
		frame = max(0, min(lastFrame, target))
		showPreview(frame)
		requestSeek(frame)
		await settled()
	}

	/// Moves to the frame at canonical `time`, for scrubbing.
	public func scrub(to time: Double) {
		guard let timing, let info else { return }
		if isPlaying {
			isPlaying = false
			player.pause()
		}
		frame = timing.clamp(timing.frame(at: time), duration: info.duration)
		showPreview(frame)
		requestSeek(frame)
	}

	/// Covers a far move's wait with the cached picture of its target.
	private func showPreview(_ target: Int) {
		guard abs(target - presentedFrame) > maxStep || seekInFlight, target != presentedFrame, stops.isEmpty,
			let image = cachedImage(target)
		else { return }
		previewClear?.cancel()
		preview = image
	}

	private func cachedImage(_ frame: Int) -> CGImage? {
		guard let data = scrubCache?.jpeg(frame), let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
		return CGImageSourceCreateImageAtIndex(source, 0, nil)
	}

	/// Resolves when no seek is in flight or pending.
	public func settled() async {
		if !seekInFlight && pendingFrame == nil { return }
		await withCheckedContinuation { seekWaiters.append($0) }
	}

	/// Shows `target`. Small moves from the presented frame use AVFoundation's own frame
	/// stepping, which keeps recently decoded frames: stepping back through long-GOP HEVC takes
	/// ~1 ms instead of decoding from the previous keyframe (~60–90 ms). Anything else, and any
	/// step that doesn't land exactly on `target`, is an exact seek.
	private func requestSeek(_ target: Int, allowStep: Bool = true) {
		if seekInFlight {
			pendingFrame = target
			return
		}
		guard let timing, let info, let item = player.currentItem else { return }
		seekInFlight = true
		isSeeking = true
		let generation = self.generation
		let delta = target - presentedFrame
		if allowStep, presentedFrame >= 0, delta < 0, -delta <= maxStep,
			item.canStepBackward
		{
			let before = item.currentTime()
			item.step(byCount: delta)
			Task { @MainActor in
				let deadline = Date().addingTimeInterval(0.25)
				while item.currentTime() == before, Date() < deadline { try? await Task.sleep(for: .microseconds(250)) }
				guard generation == self.generation else { return }
				let landed = timing.frame(at: self.canonical(item.currentTime().seconds))
				self.seekInFlight = false
				if landed == target {
					self.finishMove(target, finished: true, timing: timing)
				} else {
					// The step landed elsewhere (or not at all): settle it with an exact seek.
					self.presentedFrame = landed
					if self.pendingFrame == nil { self.pendingFrame = target }
					self.drainPending(after: landed, finished: false)
				}
			}
			return
		}
		let at = native(timing.seekTime(ofFrame: target, duration: info.duration))
		let time = CMTime(seconds: at, preferredTimescale: 600_000)
		player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
			Task { @MainActor in
				guard let self, generation == self.generation else { return }
				self.seekInFlight = false
				self.finishMove(target, finished: finished, timing: timing)
			}
		}
	}

	private func finishMove(_ target: Int, finished: Bool, timing: Timing) {
		if finished {
			presentedFrame = target
			time = timing.startTime(ofFrame: target)
			// Whatever covers the video shows the frame just presented, never another: a stop is
			// a frame the athlete must see, and the final target's preview is held a moment
			// (below) only as a picture of that same frame.
			if preview != nil {
				previewClear?.cancel()
				preview = cachedImage(target)
			}
			onPresent?(target)
			resumeStops(target)
			if target == frame, preview != nil {
				// The layer paints the sought frame on its next refresh or two; keep the
				// preview up until then so nothing older flashes between them.
				previewClear?.cancel()
				previewClear = Task { @MainActor in
					try? await Task.sleep(for: .milliseconds(34))
					if !Task.isCancelled, self.presentedFrame == self.frame { self.preview = nil }
				}
			}
		}
		drainPending(after: target, finished: finished)
	}

	private func drainPending(after target: Int, finished: Bool) {
		// A stop goes before the latest target; the latest stays pending behind it.
		if let stop = stops.first?.frame {
			if pendingFrame == nil { pendingFrame = frame }
			// A preview of a later target mustn't cover the stop while it's shown.
			if preview != nil {
				previewClear?.cancel()
				preview = cachedImage(stop)
			}
			requestSeek(stop, allowStep: finished)
			return
		}
		if let next = pendingFrame {
			pendingFrame = nil
			if next != target || !finished {
				requestSeek(next, allowStep: finished)
				return
			}
		}
		isSeeking = false
		let waiters = seekWaiters
		seekWaiters = []
		for waiter in waiters { waiter.resume() }
	}

	/// The canonical start time of the frame on screen: where a mark placed now goes.
	public var frameStartTime: Double { timing?.startTime(ofFrame: frame) ?? 0 }
}

private func mimeType(_ url: URL) -> String {
	switch url.pathExtension.lowercased() {
	case "mov", "qt": "video/quicktime"
	case "m4v": "video/x-m4v"
	case "3gp": "video/3gpp"
	default: "video/mp4"
	}
}
