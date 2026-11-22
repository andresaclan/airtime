import AVFoundation
import AirtimeKit
import CoreImage
import Foundation

/// Every frame of the video, small and JPEG-compressed, so any one can be drawn within a display
/// refresh while the timeline is dragged. The exact seek still follows and replaces it; the
/// preview only covers the wait. The native counterpart of the web app's `scrubCache.ts`.
///
/// Built in the background with AVAssetReader (hardware decode, scaled by the decoder). Frames are indexed by Airtime's own frame table, so a
/// preview is always the frame the exact seek will show.
public final class ScrubCache: @unchecked Sendable {
	/// Long side of a preview frame, in pixels.
	public static let longSide = 640.0
	/// Memory the cached frames may take.
	public static let maxBytes = 192 * 1024 * 1024

	private let lock = NSLock()
	private var frames: [Data?]
	private var bytes = 0
	private var cancelled = false
	public private(set) var isComplete = false

	public let frameCount: Int

	init(frameCount: Int) {
		self.frameCount = frameCount
		frames = Array(repeating: nil, count: frameCount)
	}

	public func jpeg(_ frame: Int) -> Data? {
		lock.lock()
		defer { lock.unlock() }
		return frames.indices.contains(frame) ? frames[frame] : nil
	}

	public var builtCount: Int {
		lock.lock()
		defer { lock.unlock() }
		return frames.reduce(0) { $0 + ($1 == nil ? 0 : 1) }
	}

	func cancel() {
		lock.lock()
		cancelled = true
		frames = []
		lock.unlock()
	}

	private var isCancelled: Bool {
		lock.lock()
		defer { lock.unlock() }
		return cancelled
	}

	private func markComplete() {
		lock.lock()
		isComplete = true
		lock.unlock()
	}

	/// Stores a frame; false once cancelled or over budget.
	private func store(_ data: Data, at frame: Int) -> Bool {
		lock.lock()
		defer { lock.unlock() }
		guard !cancelled, frames.indices.contains(frame) else { return false }
		if frames[frame] == nil {
			bytes += data.count
			frames[frame] = data
		}
		return bytes < Self.maxBytes
	}

	/// Starts building for `url`, from its first frame.
	static func build(url: URL, timing: Timing) -> ScrubCache? {
		guard let times = timing.frameTimes, !times.isEmpty else { return nil }
		let cache = ScrubCache(frameCount: times.count)
		Task.detached(priority: .utility) {
			let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
			guard let track = try? await asset.loadTracks(withMediaType: .video).first,
				let (natural, transform) = try? await track.load(.naturalSize, .preferredTransform)
			else { return }
			let scale = min(1, longSide / max(natural.width, natural.height))
			let size = CGSize(width: (natural.width * scale / 2).rounded() * 2, height: (natural.height * scale / 2).rounded() * 2)
			let context = CIContext(options: [.cacheIntermediates: false])
			let gap = timing.editGap
			// One pass over the whole file, front to back. A reader limited to a time range
			// restamps the frame straddling the range's start to the start itself, which would
			// file a trimmed-off partial frame under the first real one.
			do {
				guard !cache.isCancelled, let reader = try? AVAssetReader(asset: asset) else { return }
				let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
					kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
					kCVPixelBufferWidthKey as String: Int(size.width),
					kCVPixelBufferHeightKey as String: Int(size.height),
				])
				output.alwaysCopiesSampleData = false
				guard reader.canAdd(output) else { return }
				reader.add(output)
				guard reader.startReading() else { return }
				while let sample = output.copyNextSampleBuffer() {
					if cache.isCancelled {
						reader.cancelReading()
						return
					}
					guard let buffer = CMSampleBufferGetImageBuffer(sample) else { continue }
					let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds - gap
					let frame = timing.frame(at: pts)
					// Only frames the table knows; decode-only pre-roll falls outside it.
					guard abs(times[frame] - pts) < 0.25 / max(timing.fps, 1) else { continue }
					var image = CIImage(cvPixelBuffer: buffer)
					// Display orientation, as AVPlayerLayer shows it. The track's matrix is in y-down
					// coordinates and Core Image's are y-up, so it's flipped through the x axis.
					let oriented = image.transformed(by: CGAffineTransform(a: transform.a, b: -transform.b, c: -transform.c, d: transform.d, tx: 0, ty: 0))
					image = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
					guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
						let jpeg = context.jpegRepresentation(of: image, colorSpace: colorSpace, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7])
					else { continue }
					if !cache.store(jpeg, at: frame) {
						reader.cancelReading()
						return
					}
				}
			}
			cache.markComplete()
		}
		return cache
	}
}
