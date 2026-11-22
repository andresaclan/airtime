import AVFoundation
import AirtimeKit
import AirtimePlayer
import CoreVideo
import ImageIO
import Foundation

/// Decoded-frame oracle for the desktop player, the native counterpart of
/// `tests/frame-stepping`. Each fixture's frames carry a 16-stripe barcode of their source frame
/// index (eight stripes, then their inverse, so a black picture can't pass as frame 0), and
/// `manifest.json` holds what ffmpeg decoded independently. The player is driven exactly as the
/// app drives it, and after every step the picture AVFoundation decoded is read back and its
/// barcode compared. Nothing here imports Airtime's timing math to build expectations.
///
///     swift run -c release frame-check [fixture-name ...]

struct Fixture: Decodable {
	var file: String
	var times: [Double]
	var ids: [Int]
	var webkitOffset: Double
}

struct Failure: Error, CustomStringConvertible {
	var description: String
}

let fixturesDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
	.appendingPathComponent("../../../tests/frame-stepping/fixtures").standardizedFileURL

@MainActor
final class Checker {
	let fixture: Fixture
	let player = VideoPlayer()
	var transform = CGAffineTransform.identity
	var display = CGSize.zero
	/// Where the rotated picture's corner lands: files often rotate without translating back.
	var origin = CGPoint.zero
	var latencies: [Double] = []

	/// The file to check against this fixture's manifest entry, such as a remux of it.
	var url: URL

	init(_ fixture: Fixture, url: URL? = nil) {
		self.fixture = fixture
		self.url = url ?? fixturesDir.appendingPathComponent(fixture.file)
	}

	func open() async throws {
		let info = try await player.open(url, readback: true)
		let track = try await AVURLAsset(url: url).loadTracks(withMediaType: .video).first!
		transform = try await track.load(.preferredTransform)
		display = info.displaySize
		let natural = try await track.load(.naturalSize)
		origin = CGRect(origin: .zero, size: natural).applying(transform).origin
		guard info.timing.frameTimes?.count == fixture.ids.count else {
			throw Failure(description: "\(fixture.file): \(info.timing.frameTimes?.count ?? 0) frames in the table, ffmpeg decoded \(fixture.ids.count)")
		}
	}

	/// The barcode of the decoded picture at the player's current time; -1 when there's none.
	func barcode() -> Int {
		guard let output = player.videoOutput, let item = player.player.currentItem else { return -1 }
		guard let buffer = output.copyPixelBuffer(forItemTime: item.currentTime(), itemTimeForDisplay: nil) else { return -1 }
		CVPixelBufferLockBaseAddress(buffer, .readOnly)
		defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
		let width = CVPixelBufferGetWidth(buffer)
		let height = CVPixelBufferGetHeight(buffer)
		let row = CVPixelBufferGetBytesPerRow(buffer)
		let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
		let inverse = transform.inverted()
		var bits: [Bool] = []
		for bit in 0..<16 {
			// Sample in display orientation, as the barcode was drawn, then map into the buffer.
			let point = CGPoint(x: origin.x + (Double(bit * 16) + 8) / 256 * display.width, y: origin.y + display.height / 2).applying(inverse)
			let x = min(width - 1, max(0, Int(point.x)))
			let y = min(height - 1, max(0, Int(point.y)))
			bits.append(base[y * row + x * 4 + 1] > 128)
		}
		if (0..<8).contains(where: { bits[$0] == bits[$0 + 8] }) { return -1 }
		return (0..<8).reduce(0) { $0 + (bits[$1] ? 1 << $1 : 0) }
	}

	/// The barcode in a display-oriented image, such as a scrub preview.
	func barcode(of image: CGImage) -> Int {
		let width = image.width, height = image.height
		var pixels = [UInt8](repeating: 0, count: width * height * 4)
		let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
			space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
		context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
		let bits = (0..<16).map { bit -> Bool in
			let x = min(width - 1, Int((Double(bit * 16) + 8) / 256 * Double(width)))
			return pixels[(height / 2 * width + x) * 4 + 1] > 128
		}
		if (0..<8).contains(where: { bits[$0] == bits[$0 + 8] }) { return -1 }
		return (0..<8).reduce(0) { $0 + (bits[$1] ? 1 << $1 : 0) }
	}

	/// The picture must show frame `index`, the playhead must sit inside that frame, and it must
	/// not change while we keep looking (no late flash back to an older frame).
	func expect(_ index: Int, _ label: String) async throws {
		let start = Date()
		await player.settled()
		latencies.append(Date().timeIntervalSince(start))
		let expected = fixture.ids[index]
		var seen = -1
		let deadline = Date().addingTimeInterval(1)
		while Date() < deadline {
			seen = barcode()
			if seen == expected { break }
			try await Task.sleep(for: .milliseconds(2))
		}
		guard seen == expected else {
			throw Failure(description: "\(fixture.file) \(label): expected frame \(index) (barcode \(expected)), decoded \(seen); player frame \(player.frame), presented \(player.presentedFrame)")
		}
		guard player.frame == index, player.presentedFrame == index else {
			throw Failure(description: "\(fixture.file) \(label): picture is frame \(index) but the player reports \(player.frame)/\(player.presentedFrame)")
		}
		let native = player.player.currentTime().seconds
		let low = fixture.times[index] + fixture.webkitOffset - 2e-6
		let high = index + 1 < fixture.times.count ? fixture.times[index + 1] + fixture.webkitOffset : .infinity
		guard native >= low, native < high else {
			throw Failure(description: "\(fixture.file) \(label): playhead \(native) is outside frame \(index) [\(low), \(high))")
		}
		for _ in 0..<3 {
			try await Task.sleep(for: .milliseconds(5))
			let again = barcode()
			if again != expected, again >= 0 {
				throw Failure(description: "\(fixture.file) \(label): frame \(index) was shown, then barcode \(again)")
			}
		}
	}

	func run() async throws {
		try await open()
		let last = fixture.ids.count - 1
		try await expect(0, "open")
		for k in 1...last {
			player.step(1)
			try await expect(k, "step forward")
		}
		for k in stride(from: last - 1, through: 0, by: -1) {
			player.step(-1)
			try await expect(k, "step back")
		}
		// Held key: steps arrive faster than frames decode.
		for _ in 0..<7 { player.step(1) }
		try await expect(min(7, last), "rapid forward")
		for _ in 0..<4 { player.step(-1) }
		try await expect(max(0, min(7, last) - 4), "rapid back")
		// Random access, as marks and the timeline do it.
		var rng = SystemRandomNumberGenerator()
		for _ in 0..<12 {
			let target = Int.random(in: 0...last, using: &rng)
			await player.seek(toFrame: target)
			try await expect(target, "seek to \(target)")
		}
		// A timeline drag: many targets, only the last matters.
		let timing = player.timing!
		for k in stride(from: 0, through: last, by: max(1, last / 9)) { player.scrub(to: timing.startTime(ofFrame: k)) }
		player.scrub(to: timing.seekTime(ofFrame: last / 2))
		try await expect(last / 2, "scrub")
		// A frame asked to be shown (a mark's) is shown even when a later step arrives while
		// an earlier seek is still decoding, and before that later step.
		var shown: [Int] = []
		var coveredWrongly: [Int] = []
		player.onPresent = { [unowned self] frame in
			shown.append(frame)
			// Whatever covers the video at a presented frame must be that frame.
			if let image = self.player.preview, self.barcode(of: image) != self.fixture.ids[frame] { coveredWrongly.append(frame) }
		}
		// Two marks pressed in quick succession, each followed by a step, while a far seek decodes.
		player.scrub(to: timing.seekTime(ofFrame: last))
		player.step(-3)
		let first = player.frame
		let firstStop = player.addStop(first)
		player.step(-2)
		let stop = player.frame
		let secondStop = player.addStop(stop)
		player.step(-2)
		let ok = await player.waitForStop(firstStop)
		let ok2 = await player.waitForStop(secondStop)
		await player.settled()
		// (The picture itself is checked by `expect`, which waits for the output to catch up.)
		guard ok, ok2, let a = shown.firstIndex(of: first), let b = shown.lastIndex(of: stop), a < b, b < shown.count - 1,
			shown.last == stop - 2, player.frame == stop - 2, coveredWrongly.isEmpty
		else {
			throw Failure(description: "\(fixture.file): stops at \(first) and \(stop), each then a step: presented \(shown), covered by another frame's preview at \(coveredWrongly)")
		}
		try await expect(stop - 2, "step after a stop")
		// Stops queued behind a seek already heading to the later one are still shown in order.
		await player.seek(toFrame: last)
		player.scrub(to: timing.seekTime(ofFrame: 4))
		shown = []
		let early = player.addStop(1)
		let late = player.addStop(4)
		player.step(-4)
		let okEarly = await player.waitForStop(early)
		let okLate = await player.waitForStop(late)
		await player.settled()
		guard okEarly, okLate, let i1 = shown.firstIndex(of: 1), let i4 = shown.lastIndex(of: 4), i1 < i4, shown.last == 0, coveredWrongly.isEmpty else {
			throw Failure(description: "\(fixture.file): stops at 1 then 4 behind a seek to 4: presented \(shown)")
		}
		player.onPresent = nil
		try await expect(0, "step after queued stops")
		// Play straight after a drag starts from the drag's last target, not an earlier one,
		// and drops the drag's preview.
		player.scrub(to: timing.seekTime(ofFrame: last))
		player.scrub(to: timing.seekTime(ofFrame: last / 2))
		player.speed = 0.25
		player.play()
		try await Task.sleep(for: .milliseconds(120))
		let resumed = player.frame
		let playing = player.isPlaying && player.player.rate > 0
		let native = player.player.currentTime().seconds - fixture.webkitOffset
		player.pause()
		guard playing, resumed >= last / 2, resumed < last, native >= fixture.times[last / 2] - 1e-3, player.preview == nil else {
			throw Failure(description: "\(fixture.file): play after a drag to \(last / 2): playing \(playing), resumed at \(resumed) (playhead \(native)), preview \(player.preview == nil ? "cleared" : "still shown")")
		}
		// Play then Pause before the play has started leaves it paused.
		player.scrub(to: timing.seekTime(ofFrame: 0))
		player.play()
		player.pause()
		try await Task.sleep(for: .milliseconds(80))
		guard !player.isPlaying, player.player.rate == 0 else {
			throw Failure(description: "\(fixture.file): a pause straight after play still started playback")
		}
		await player.settled()
		// Play, pause, then step: the pause settles on a frame and the step moves from it.
		await player.seek(toFrame: 0)
		player.speed = 0.25
		player.play()
		try await Task.sleep(for: .milliseconds(250))
		player.pause()
		let paused = player.frame
		try await expect(paused, "pause")
		if paused < last {
			player.step(1)
			try await expect(paused + 1, "step after pause")
		}
		// Every cached preview is the frame it's filed under.
		let cache = player.scrubCache!
		let deadline = Date().addingTimeInterval(10)
		while !cache.isComplete, Date() < deadline { try await Task.sleep(for: .milliseconds(20)) }
		guard cache.builtCount == fixture.ids.count else {
			throw Failure(description: "\(fixture.file): preview cache built \(cache.builtCount) of \(fixture.ids.count) frames")
		}
		for k in 0...last {
			let data = cache.jpeg(k)!
			let source = CGImageSourceCreateWithData(data as CFData, nil)!
			let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
			let id = barcode(of: image)
			guard id == fixture.ids[k] else {
				throw Failure(description: "\(fixture.file): preview of frame \(k) shows barcode \(id), expected \(fixture.ids[k])")
			}
		}
		// Replacing the file within one player.
		try await open()
		try await expect(0, "reopen")
		player.step(1)
		try await expect(1, "step after reopen")
	}
}

@main
struct FrameCheck {
	@MainActor static func main() async {
		// `--as <fixture> <file>`: check another file, such as a remux, against a fixture's frames.
		if CommandLine.arguments.count > 3, CommandLine.arguments[1] == "--as" {
			let data = try! Data(contentsOf: fixturesDir.appendingPathComponent("manifest.json"))
			let fixture = try! JSONDecoder().decode([Fixture].self, from: data).first { $0.file == CommandLine.arguments[2] }!
			let checker = Checker(fixture, url: URL(fileURLWithPath: CommandLine.arguments[3]))
			do {
				try await checker.run()
				print("ok   \(CommandLine.arguments[3]) as \(fixture.file)")
				exit(0)
			} catch {
				print("FAIL \(error)")
				exit(1)
			}
		}
		if CommandLine.arguments.count > 2, CommandLine.arguments[1] == "--bench" {
			await bench(URL(fileURLWithPath: CommandLine.arguments[2]))
			exit(0)
		}
		let data = try! Data(contentsOf: fixturesDir.appendingPathComponent("manifest.json"))
		var fixtures = try! JSONDecoder().decode([Fixture].self, from: data)
		let only = Set(CommandLine.arguments.dropFirst())
		if !only.isEmpty { fixtures = fixtures.filter { only.contains($0.file) } }
		var failed = 0
		for fixture in fixtures {
			let checker = Checker(fixture)
			do {
				try await checker.run()
				let sorted = checker.latencies.sorted()
				let median = sorted[sorted.count / 2] * 1000
				let worst = (sorted.last ?? 0) * 1000
				print(String(format: "ok   %-14@ %3d frames  step median %5.1f ms  worst %5.1f ms", fixture.file as NSString, fixture.ids.count, median, worst))
			} catch {
				failed += 1
				print("FAIL \(error)")
			}
			checker.player.close()
		}
		print(failed == 0 ? "All \(fixtures.count) fixtures passed." : "\(failed) of \(fixtures.count) fixtures failed.")
		exit(failed == 0 ? 0 : 1)
	}
}

/// How long steps and scrubs take on a real file: `frame-check --bench clip.mov`.
@MainActor func bench(_ url: URL) async {
	let player = VideoPlayer()
	let info = try! await player.open(url, readback: true)
	let last = player.lastFrame
	let output = player.videoOutput!
	/// Until the decoded picture for the playhead is in hand, as the screen needs it.
	func decoded() async {
		await player.settled()
		let item = player.player.currentItem!
		let deadline = Date().addingTimeInterval(2)
		while Date() < deadline {
			var shown = CMTime.zero
			let now = item.currentTime()
			if output.copyPixelBuffer(forItemTime: now, itemTimeForDisplay: &shown) != nil || output.hasNewPixelBuffer(forItemTime: now) == false && shown == now { return }
			try? await Task.sleep(for: .microseconds(500))
		}
	}
	func timed(_ label: String, _ body: () async -> Void) async -> Double {
		let start = Date()
		await body()
		return Date().timeIntervalSince(start) * 1000
	}
	func report(_ label: String, _ samples: [Double]) {
		let sorted = samples.sorted()
		print(String(format: "%-26@ median %6.1f ms  p90 %6.1f ms  worst %6.1f ms", label as NSString,
			sorted[sorted.count / 2], sorted[Int(Double(sorted.count) * 0.9)], sorted.last!))
	}
	print("\(url.lastPathComponent): \(Int(info.displaySize.width))x\(Int(info.displaySize.height)) \(info.timing.fps) fps, \(last + 1) frames")
	let buildStart = Date()
	if let cache = player.scrubCache {
		while !cache.isComplete, Date().timeIntervalSince(buildStart) < 120 { try? await Task.sleep(for: .milliseconds(20)) }
		let bytes = (0...last).reduce(0) { $0 + (cache.jpeg($1)?.count ?? 0) }
		print(String(format: "preview cache: %d of %d frames in %.1f s, %.1f MB", cache.builtCount, last + 1, Date().timeIntervalSince(buildStart), Double(bytes) / 1_048_576))
		var decode: [Double] = []
		for k in stride(from: 0, to: last, by: max(1, last / 50)) {
			let start = Date()
			if let data = cache.jpeg(k), let source = CGImageSourceCreateWithData(data as CFData, nil),
				let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) { _ = image.width }
			decode.append(Date().timeIntervalSince(start) * 1000)
		}
		report("preview decode (drag)", decode)
	}
	await player.seek(toFrame: last / 2)
	var forward: [Double] = []
	for _ in 0..<60 { forward.append(await timed("") { player.step(1); await decoded() }) }
	report("step forward", forward)
	var back: [Double] = []
	for _ in 0..<60 { back.append(await timed("") { player.step(-1); await decoded() }) }
	report("step back", back)
	var random: [Double] = []
	for _ in 0..<30 { random.append(await timed("") { await player.seek(toFrame: Int.random(in: 0...last)); await decoded() }) }
	report("jump to any frame", random)
	// A drag: a new target every 8 ms (120 Hz pointer), only the latest kept.
	var drag: [Double] = []
	for _ in 0..<5 {
		let start = Int.random(in: 0...(last / 2))
		drag.append(await timed("") {
			for k in 0..<40 {
				player.scrub(to: info.timing.startTime(ofFrame: start + k * 3))
				try? await Task.sleep(for: .milliseconds(8))
			}
			await decoded()
		} - 40 * 8)
	}
	report("drag settle after release", drag)
	player.close()
}
