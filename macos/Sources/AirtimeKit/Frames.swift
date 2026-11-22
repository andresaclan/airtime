import Foundation

/// Conversions between frame indexes and media time, ported from `src/lib/video/frames.ts`.
/// Every seek and every frame lookup goes through here, so the frame on screen is the frame
/// Airtime records.
///
/// With a timing table (`frameTimes`, read from the file by `VideoTiming.parse`) frame k is
/// the k-th frame that plays, whatever the spacing.
///
/// - Frame k occupies [frameTimes[k], frameTimes[k + 1]). Stored times (marks, exports,
///   saved sessions) are frame starts: frameTimes[k].
/// - Seeks go to the middle of a frame.
/// - A playhead time maps to the frame it falls in (floor), with a small tolerance.
///
/// Without a table frames are assumed evenly spaced: frame k occupies [k / fps, (k + 1) / fps).
///
/// Times here are on the canonical timeline the web app stores: a partial-frame edit's gap is
/// removed. AVFoundation keeps it, so the player adds `editGap` at its boundary.
public struct Timing: Equatable, Sendable {
	public var fps: Double
	public var frameTimes: [Double]?
	public var editGap: Double

	public init(fps: Double, frameTimes: [Double]? = nil, editGap: Double = 0) {
		self.fps = fps
		self.frameTimes = frameTimes?.isEmpty == true ? nil : frameTimes
		self.editGap = editGap
	}

	/// Just a constant frame rate, as exports and saved sessions without their video know it.
	public static func rate(_ fps: Double) -> Timing { Timing(fps: fps) }
}

/// Fraction of a frame by which a time may fall short of a frame start and still count as it.
public let frameTolerance = 1e-3
/// Exports round times to the microsecond.
private let storedTimeTolerance = 2e-6

/// Index of the last entry at or before `time`; 0 when `time` comes before them all.
func lastAtOrBefore(_ times: [Double], _ time: Double) -> Int {
	var low = 0
	var high = times.count - 1
	while low < high {
		let middle = (low + high + 1) / 2
		if times[middle] <= time { low = middle } else { high = middle - 1 }
	}
	return low
}

private func nearest(_ times: [Double], _ time: Double) -> Int {
	let before = lastAtOrBefore(times, time)
	let after = min(before + 1, times.count - 1)
	return abs(times[after] - time) < abs(time - times[before]) ? after : before
}

extension Timing {
	/// The frame a playhead falls in.
	public func frame(at time: Double) -> Int {
		if let times = frameTimes {
			if !time.isFinite { return 0 }
			let tolerance = fps > 0 ? frameTolerance / fps : 0
			return lastAtOrBefore(times, time + tolerance)
		}
		guard time > 0, fps > 0 else { return 0 }
		return Int((time * fps + frameTolerance).rounded(.down))
	}

	/// The frame a stored (mark) time refers to. See `frameOfMarkTime` in frames.ts for the
	/// legacy grid times this also accepts.
	public func frame(ofMarkTime time: Double) -> Int {
		guard fps > 0, time.isFinite else { return frame(at: time) }
		guard let times = frameTimes else { return max(0, Int((time * fps).rounded())) }
		let closest = nearest(times, time)
		if abs(times[closest] - time) <= storedTimeTolerance { return closest }
		return frame(at: ((time * fps).rounded() + 0.5) / fps)
	}

	/// Start of frame k: the time stored for a mark on that frame.
	public func startTime(ofFrame frame: Int) -> Double {
		if let times = frameTimes { return times[max(0, min(times.count - 1, frame))] }
		return Double(frame) / fps
	}

	/// End of frame k: the next frame's start. The last frame in a table lasts one nominal frame.
	public func endTime(ofFrame frame: Int) -> Double {
		guard let times = frameTimes else { return Double(frame + 1) / fps }
		let k = max(0, min(times.count - 1, frame))
		return k + 1 < times.count ? times[k + 1] : times[k] + 1 / fps
	}

	/// Middle of frame k: where to seek to show it. Never past `duration`, when known.
	public func seekTime(ofFrame frame: Int, duration: Double = .infinity) -> Double {
		var time: Double
		if let times = frameTimes {
			let k = max(0, min(times.count - 1, frame))
			var end = endTime(ofFrame: k)
			if k + 1 == times.count, duration > times[k] { end = min(end, duration) }
			time = (times[k] + end) / 2
		} else {
			time = (Double(max(0, frame)) + 0.5) / fps
		}
		return duration > 0 ? min(time, duration) : time
	}

	/// Index of the last frame; without a table, the last that starts before `duration`.
	public func lastFrame(duration: Double) -> Int {
		if let times = frameTimes { return times.count - 1 }
		guard fps > 0, duration.isFinite, duration > 0 else { return Int.max }
		return max(0, Int((duration * fps - frameTolerance).rounded(.up)) - 1)
	}

	public func clamp(_ frame: Int, duration: Double) -> Int {
		max(0, min(lastFrame(duration: duration), frame))
	}

	/// The frame number a timecode shows for frame k: its place on the frame-rate grid,
	/// counted from the first frame.
	public func label(ofFrame frame: Int) -> Int {
		guard let times = frameTimes, fps > 0 else { return frame }
		return Int(((startTime(ofFrame: frame) - times[0]) * fps).rounded())
	}

	/// Shortest and longest frame in the table, in seconds.
	public var frameDurationRange: (Double, Double)? {
		guard let times = frameTimes, times.count >= 2 else { return nil }
		var shortest = Double.infinity
		var longest = 0.0
		for k in 1..<times.count {
			let gap = times[k] - times[k - 1]
			shortest = min(shortest, gap)
			longest = max(longest, gap)
		}
		return (shortest, longest)
	}

	/// The real start of the frame a stored time refers to.
	public func markFrameStart(_ time: Double) -> Double {
		frameTimes != nil ? startTime(ofFrame: frame(ofMarkTime: time)) : time
	}

	/// The real end of the frame a stored time refers to: the next frame's start.
	public func markFrameEnd(_ time: Double) -> Double {
		frameTimes != nil ? endTime(ofFrame: frame(ofMarkTime: time)) : time + 1 / fps
	}
}

/// Clock time to the millisecond, e.g. 0:02.250 or 1:02:03.500.
public func formatClock(_ seconds: Double) -> String {
	let totalMs = seconds.isFinite && seconds > 0 ? Int((seconds * 1000).rounded()) : 0
	let ms = totalMs % 1000
	let totalSeconds = totalMs / 1000
	let s = totalSeconds % 60
	let totalMinutes = totalSeconds / 60
	let m = totalMinutes % 60
	let h = totalMinutes / 60
	let tail = String(format: "%02d.%03d", s, ms)
	return h > 0 ? String(format: "%d:%02d:", h, m) + tail : "\(m):" + tail
}

extension Timing {
	/// Clock time of frame k on the frame-rate grid, as the web app's readouts show it.
	public func clock(ofFrame frame: Int) -> String { formatClock(fps > 0 ? Double(label(ofFrame: frame)) / fps : 0) }
	/// The video's length on the same grid: the end of its last frame.
	public func durationClock(duration: Double) -> String {
		if frameTimes != nil { return formatClock(fps > 0 ? Double(label(ofFrame: lastFrame(duration: duration)) + 1) / fps : 0) }
		return formatClock(duration)
	}
}
