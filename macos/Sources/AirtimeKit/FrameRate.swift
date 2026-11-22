import Foundation

/// Frame timing read from the sample tables of MP4/M4V/MOV files, and snapping of measured
/// rates to standard ones. Ported from `src/lib/video/frameRate.ts` so the desktop app puts
/// marks on exactly the frames, and at exactly the times, the web app does.

private let standardFrameRates: [Double] = [
	15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240,
]

private let containerTypes: Set<String> = ["moov", "trak", "mdia", "minf", "stbl", "edts", "udta", "meta"]
private let maxMoovBytes = 64 * 1024 * 1024
/// Longer gaps (a pause in recording) say nothing about the frame rate.
private let maxFramesPerGap = 8.0

public struct SttsEntry: Equatable, Sendable { public var count: Int; public var delta: Int }
public struct CttsEntry: Equatable, Sendable { public var count: Int; public var offset: Int }
public struct EditListEntry: Equatable, Sendable {
	public var segmentDuration: Double
	public var mediaTime: Double
	public var mediaRate: Double
}

public struct SampleTables: Sendable {
	public var timescale: Double
	public var movieTimescale: Double
	public var stts: [SttsEntry]
	public var ctts: [CttsEntry]
	public var elst: [EditListEntry]
}

public struct FrameTimingAnalysis: Equatable, Sendable {
	/// The rate frame math should use: the measured rate snapped to a standard one.
	public var fps: Double
	public var measuredFps: Double
	public var variableFrameRate: Bool
	public var maxDriftFrames: Double
}

public struct VideoTiming: Equatable, Sendable {
	public var analysis: FrameTimingAnalysis
	/// Gap before the first complete frame, removed from the canonical timeline.
	public var editGap: Double
	public var frameTimes: [Double]
	public var timescale: Double

	public init(analysis: FrameTimingAnalysis, editGap: Double, frameTimes: [Double], timescale: Double) {
		self.analysis = analysis
		self.editGap = editGap
		self.frameTimes = frameTimes
		self.timescale = timescale
	}

	public var fps: Double { analysis.fps }
	public var timing: Timing { Timing(fps: analysis.fps, frameTimes: frameTimes, editGap: editGap) }
}

private struct Box {
	var type: String
	var start: Int
	var end: Int
	var headerSize: Int
}

/// Big-endian reads over a byte buffer; out-of-range reads return nil.
private struct Reader {
	let bytes: [UInt8]
	func u8(_ o: Int) -> UInt8? { o >= 0 && o < bytes.count ? bytes[o] : nil }
	func u16(_ o: Int) -> UInt16? {
		guard o >= 0, o + 2 <= bytes.count else { return nil }
		return UInt16(bytes[o]) << 8 | UInt16(bytes[o + 1])
	}
	func u32(_ o: Int) -> UInt32? {
		guard o >= 0, o + 4 <= bytes.count else { return nil }
		return UInt32(bytes[o]) << 24 | UInt32(bytes[o + 1]) << 16 | UInt32(bytes[o + 2]) << 8 | UInt32(bytes[o + 3])
	}
	func i32(_ o: Int) -> Int32? { u32(o).map { Int32(bitPattern: $0) } }
	func u64(_ o: Int) -> UInt64? {
		guard let hi = u32(o), let lo = u32(o + 4) else { return nil }
		return UInt64(hi) << 32 | UInt64(lo)
	}
	func type(_ o: Int) -> String {
		guard o >= 0, o + 4 <= bytes.count else { return "" }
		return String(decoding: bytes[o..<o + 4], as: UTF8.self)
	}

	func boxes(_ start: Int, _ end: Int) -> [Box] {
		var result: [Box] = []
		var offset = start
		while offset + 8 <= end {
			guard let size32 = u32(offset) else { break }
			let type = self.type(offset + 4)
			var boxSize = Int(size32)
			var headerSize = 8
			if size32 == 1 {
				guard offset + 16 <= end, let size64 = u64(offset + 8), size64 > 16, size64 < UInt64(Int.max) else { break }
				boxSize = Int(size64)
				headerSize = 16
			} else if size32 == 0 {
				boxSize = end - offset
			}
			if boxSize < headerSize { break }
			let boxEnd = offset + boxSize
			if boxEnd > end { break }
			result.append(Box(type: type, start: offset, end: boxEnd, headerSize: headerSize))
			offset = boxEnd
		}
		return result
	}

	func children(_ box: Box) -> [Box] {
		guard containerTypes.contains(box.type) else { return [] }
		var payload = box.start + box.headerSize
		if box.type == "meta" {
			if payload + 4 > box.end { return [] }
			payload += 4
		}
		return boxes(payload, box.end)
	}

	func child(_ parent: Box?, _ type: String) -> Box? {
		guard let parent else { return nil }
		return children(parent).first { $0.type == type }
	}

	func timescale(_ box: Box) -> Double? {
		let offset = box.start + box.headerSize
		if offset + 12 > box.end { return nil }
		guard let version = u8(offset) else { return nil }
		let at = version == 1 ? offset + 20 : offset + 12
		if at + 4 > box.end { return nil }
		guard let value = u32(at), value > 0 else { return nil }
		return Double(value)
	}

	func entries<T>(_ box: Box, size: (UInt8) -> Int, read: (Int, UInt8) -> T?) -> [T]? {
		let payload = box.start + box.headerSize
		if payload + 8 > box.end { return nil }
		guard let version = u8(payload), let count = u32(payload + 4) else { return nil }
		let entrySize = size(version)
		if payload + 8 + Int(count) * entrySize > box.end { return nil }
		var out: [T] = []
		out.reserveCapacity(Int(count))
		for i in 0..<Int(count) {
			guard let entry = read(payload + 8 + i * entrySize, version) else { return nil }
			out.append(entry)
		}
		return out
	}
}

extension VideoTiming {
	/// The timing tables of the first video track, or nil. `bytes` can be the whole file or
	/// just its `moov` box.
	public static func sampleTables(_ bytes: [UInt8]) -> SampleTables? {
		let r = Reader(bytes: bytes)
		guard let moov = r.boxes(0, bytes.count).first(where: { $0.type == "moov" }) else { return nil }
		// A fragmented file's `moov` holds at most its first samples; the rest are in `moof`
		// boxes, so its table here would be short. Such files aren't marked.
		if r.child(moov, "mvex") != nil { return nil }
		let movieTimescale = r.child(moov, "mvhd").flatMap(r.timescale)
		for trak in r.children(moov) where trak.type == "trak" {
			let mdia = r.child(trak, "mdia")
			guard let hdlr = r.child(mdia, "hdlr"), r.type(hdlr.start + hdlr.headerSize + 8) == "vide" else { continue }
			let timescale = r.child(mdia, "mdhd").flatMap(r.timescale)
			let stbl = r.child(r.child(mdia, "minf"), "stbl")
			guard let timescale, let sttsBox = r.child(stbl, "stts") else { continue }
			guard let stts = r.entries(sttsBox, size: { _ in 8 }, read: { o, _ -> SttsEntry? in
				guard let c = r.u32(o), let d = r.u32(o + 4) else { return nil }
				return SttsEntry(count: Int(c), delta: Int(d))
			}), !stts.isEmpty else { continue }
			// Offsets are signed in both versions: ffmpeg writes negative ones in version 0.
			let ctts = r.child(stbl, "ctts").flatMap { box in
				r.entries(box, size: { _ in 8 }, read: { o, _ -> CttsEntry? in
					guard let c = r.u32(o), let off = r.i32(o + 4) else { return nil }
					return CttsEntry(count: Int(c), offset: Int(off))
				})
			} ?? []
			let elst = r.child(r.child(trak, "edts"), "elst").flatMap { box in
				r.entries(box, size: { $0 == 1 ? 20 : 12 }, read: { o, version -> EditListEntry? in
					let wide = version == 1
					guard let duration = wide ? r.u64(o).map(Double.init) : r.u32(o).map(Double.init) else { return nil }
					let media: Double?
					if wide { media = r.u64(o + 8).map { Double(Int64(bitPattern: $0)) } } else { media = r.i32(o + 4).map(Double.init) }
					let rateOffset = o + (wide ? 16 : 8)
					guard let media, let whole = r.u16(rateOffset), let frac = r.u16(rateOffset + 2) else { return nil }
					return EditListEntry(
						segmentDuration: duration, mediaTime: media,
						mediaRate: Double(Int16(bitPattern: whole)) + Double(frac) / 65536)
				})
			} ?? []
			return SampleTables(timescale: timescale, movieTimescale: movieTimescale ?? timescale, stts: stts, ctts: ctts, elst: elst)
		}
		return nil
	}

	/// Composition times in media ticks of every sample, in decode order.
	public static func compositionTimes(_ tables: SampleTables) -> [Double] {
		var result: [Double] = []
		var decodeTime = 0.0
		var index = 0
		var left = tables.ctts.first?.count ?? 0
		for entry in tables.stts {
			for _ in 0..<entry.count {
				while left == 0 && index < tables.ctts.count - 1 {
					index += 1
					left = tables.ctts[index].count
				}
				var offset = 0.0
				if left > 0 {
					offset = Double(tables.ctts[index].offset)
					left -= 1
				}
				result.append(decodeTime + offset)
				decodeTime += Double(entry.delta)
			}
		}
		return result
	}

	/// The frames that play, in order, with the gap a partial-frame edit removes.
	public static func presentedFrames(_ tables: SampleTables) -> (times: [Double], editGap: Double) {
		let composition = compositionTimes(tables).sorted()
		if tables.elst.isEmpty { return (composition.map { $0 / tables.timescale }, 0) }
		var times: [Double] = []
		var editStart = 0.0
		var leadingEmpty: Double?
		for edit in tables.elst {
			let seconds = edit.segmentDuration / tables.movieTimescale
			if edit.mediaTime >= 0 && edit.mediaRate != 0 {
				if leadingEmpty == nil { leadingEmpty = editStart }
				let end = edit.segmentDuration > 0 ? edit.mediaTime + seconds * tables.timescale : .infinity
				for ticks in composition where ticks >= edit.mediaTime && ticks < end {
					times.append(editStart + (ticks - edit.mediaTime) / tables.timescale)
				}
			}
			editStart += seconds
		}
		// An edit that starts partway through a frame hides that frame, and ffmpeg moves the
		// next one back to the start of the edit rather than leave a gap.
		let gap = !times.isEmpty && leadingEmpty != nil ? times[0] - leadingEmpty! : 0
		return (gap > 0 ? times.map { $0 - gap } : times, max(0, gap))
	}

	public static func snap(_ fps: Double, tolerance: Double = 0.015) -> Double {
		let nearest = standardFrameRates.reduce(standardFrameRates[0]) { abs($1 - fps) < abs($0 - fps) ? $1 : $0 }
		if abs(nearest - fps) / nearest <= tolerance { return nearest }
		return (fps * 100).rounded() / 100
	}

	/// Fits one frame rate to frame timestamps and checks whether it describes them.
	public static func analyze(_ frameTimes: [Double], timescale: Double) -> FrameTimingAnalysis? {
		guard frameTimes.count >= 2 else { return nil }
		let deltas = (1..<frameTimes.count).map { frameTimes[$0] - frameTimes[$0 - 1] }
		let positive = deltas.filter { $0 > 0 }.sorted()
		guard !positive.isEmpty else { return nil }
		let mid = positive.count / 2
		let typical = positive.count % 2 == 0 ? (positive[mid - 1] + positive[mid]) / 2 : positive[mid]
		guard typical > 0 else { return nil }
		let regular = deltas.filter { abs($0 - typical) <= 0.5 * typical }
		let duration = regular.reduce(0, +) / Double(regular.count)
		var frames = 0.0
		var span = 0.0
		for delta in deltas {
			let spanned = (delta / duration).rounded()
			if spanned < 1 || spanned > maxFramesPerGap { continue }
			frames += spanned
			span += delta
		}
		let measured = frames / span
		guard measured.isFinite, measured >= 1, measured <= 1000 else { return nil }
		let fps = snap(measured)
		let frameDuration = 1 / fps
		let allowed = max(1 / timescale, 0.25 * frameDuration) + 1e-9
		let uneven = deltas.contains { abs($0 - frameDuration) > allowed }
		let start = frameTimes[0]
		var drift = 0.0
		for (k, time) in frameTimes.enumerated() { drift = max(drift, abs((time - start) * fps - Double(k))) }
		return FrameTimingAnalysis(fps: fps, measuredFps: measured, variableFrameRate: uneven || drift > 0.5, maxDriftFrames: drift)
	}

	/// Frame timing of the first video track, or nil when it can't be read.
	public static func parse(moov bytes: [UInt8]) -> VideoTiming? {
		guard let tables = sampleTables(bytes) else { return nil }
		let (times, gap) = presentedFrames(tables)
		guard let analysis = analyze(times, timescale: tables.timescale) else { return nil }
		return VideoTiming(analysis: analysis, editGap: gap, frameTimes: times, timescale: tables.timescale)
	}

	/// Walks the top-level boxes by their headers and reads only `moov`.
	public static func readMoov(_ url: URL) -> [UInt8]? {
		guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
		defer { try? handle.close() }
		guard let size = try? handle.seekToEnd() else { return nil }
		var offset: UInt64 = 0
		while offset + 8 <= size {
			guard (try? handle.seek(toOffset: offset)) != nil, let header = try? handle.read(upToCount: 16), header.count >= 8 else { return nil }
			let h = [UInt8](header)
			let r = Reader(bytes: h)
			let type = r.type(4)
			// Not an ISO BMFF file: box types are printable ASCII.
			guard type.utf8.count == 4, type.utf8.allSatisfy({ $0 >= 0x20 && $0 <= 0x7e }) else { return nil }
			var boxSize = UInt64(r.u32(0) ?? 0)
			if boxSize == 1 {
				guard let wide = r.u64(8) else { return nil }
				boxSize = wide
			} else if boxSize == 0 {
				boxSize = size - offset
			}
			if boxSize < 8 { return nil }
			if type == "moov" {
				guard boxSize <= UInt64(maxMoovBytes), offset + boxSize <= size else { return nil }
				try? handle.seek(toOffset: offset)
				guard let data = try? handle.read(upToCount: Int(boxSize)) else { return nil }
				return [UInt8](data)
			}
			offset += boxSize
		}
		return nil
	}

	public static func detect(_ url: URL) -> VideoTiming? {
		readMoov(url).flatMap { parse(moov: $0) }
	}
}
