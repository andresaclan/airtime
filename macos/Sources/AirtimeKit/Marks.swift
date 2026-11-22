import Foundation

/// Manually marked jump events and the timings derived from them. Ported from
/// `src/lib/video/marks.ts` and `jumpUnits.ts`.
///
/// A takeoff mark is on the last frame a toe still touches the ground; a landing mark is on the
/// first frame the feet touch down again. Flight runs from the takeoff frame to the landing
/// frame; contact runs from the plant frame to the first frame in the air.
public enum MarkType: String, Codable, Sendable, CaseIterable {
	case takeoff
	case landing
}

/// `time` is media seconds: the start of the marked frame.
public struct Mark: Codable, Equatable, Hashable, Sendable, Identifiable {
	public var id: String
	public var type: MarkType
	public var time: Double

	public init(id: String = newId(), type: MarkType, time: Double) {
		self.id = id
		self.type = type
		self.time = time
	}
}

public enum IntervalKind: String, Codable, Sendable {
	case flight
	case contact
}

public struct Interval: Equatable, Sendable {
	public var kind: IntervalKind
	public var from: Mark
	public var to: Mark
	/// Media seconds.
	public var seconds: Double
	/// Real-world seconds: `seconds × timeScale`.
	public var realSeconds: Double
	public var frames: Int
	/// Jump height from real flight time (h = g·t²/8); flight intervals only.
	public var heightCm: Double?
}

public struct Analysis: Sendable {
	public var intervals: [Interval]
	/// Marks whose type repeats the previous mark's.
	public var outOfSequence: Set<String>
}

public struct Jump: Sendable {
	public var takeoff: Mark
	public var landing: Mark?
	public var contact: Interval?
	public var flight: Interval?

	public init(takeoff: Mark, landing: Mark?, contact: Interval?, flight: Interval?) {
		self.takeoff = takeoff
		self.landing = landing
		self.contact = contact
		self.flight = flight
	}
}

public enum UnpairedReason: String, Sendable {
	case outOfSequence = "out-of-sequence"
	case alone
}

public let gravity = 9.81

public func newId() -> String { UUID().uuidString.lowercased() }

public func sortMarks(_ marks: [Mark]) -> [Mark] {
	// Stable, as Array.prototype.sort is.
	marks.enumerated().sorted { a, b in a.element.time != b.element.time ? a.element.time < b.element.time : a.offset < b.offset }.map(\.element)
}

/// Start of the first frame in the air: the end of the takeoff frame.
public func firstAirborneTime(_ takeoff: Mark, _ timing: Timing) -> Double {
	timing.markFrameEnd(takeoff.time)
}

/// Adds a mark on the frame at playhead `time`. A mark already on the same frame is replaced,
/// or removed when it has the same type, so pressing a key twice toggles it.
public func placeMark(_ marks: [Mark], type: MarkType, time: Double, timing: Timing) -> [Mark] {
	let frame = timing.frame(at: time)
	let existing = marks.first { timing.frame(ofMarkTime: $0.time) == frame }
	let rest = marks.filter { $0.id != existing?.id }
	if existing?.type == type { return rest }
	return sortMarks(rest + [Mark(type: type, time: timing.startTime(ofFrame: frame))])
}

public func moveMark(_ marks: [Mark], id: String, time: Double) -> [Mark] {
	sortMarks(marks.map { $0.id == id ? Mark(id: $0.id, type: $0.type, time: time) : $0 })
}

public func removeMark(_ marks: [Mark], id: String) -> [Mark] {
	marks.filter { $0.id != id }
}

public func markAtFrame(_ marks: [Mark], time: Double, timing: Timing) -> Mark? {
	let frame = timing.frame(at: time)
	return marks.first { timing.frame(ofMarkTime: $0.time) == frame }
}

/// `timeScale` is real seconds per media second: 1 for real-time footage, 0.25 for 4× slow motion.
public func analyzeMarks(_ marks: [Mark], timing: Timing, timeScale: Double = 1, jumpType: JumpType? = .approach) -> Analysis {
	var intervals: [Interval] = []
	var outOfSequence = Set<String>()
	guard marks.count > 1 else { return Analysis(intervals: [], outOfSequence: []) }
	for i in 1..<marks.count {
		let from = marks[i - 1]
		let to = marks[i]
		let beforeFrom = i >= 2 ? marks[i - 2] : nil
		if from.type == to.type {
			// A separate touchdown after a completed flight starts the next jump.
			if !(from.type == .landing && beforeFrom?.type == .takeoff) { outOfSequence.insert(to.id) }
			continue
		}
		// Only repeat hops deliberately share the previous flight's touchdown.
		if from.type == .landing && beforeFrom?.type == .takeoff && jumpType != .repeatHops { continue }
		let kind: IntervalKind = from.type == .takeoff ? .flight : .contact
		let seconds = kind == .flight
			? timing.markFrameStart(to.time) - timing.markFrameStart(from.time)
			: firstAirborneTime(to, timing) - timing.markFrameStart(from.time)
		let real = seconds * timeScale
		let markFrames = timing.frame(ofMarkTime: to.time) - timing.frame(ofMarkTime: from.time)
		intervals.append(Interval(
			kind: kind, from: from, to: to, seconds: seconds, realSeconds: real,
			frames: kind == .flight ? markFrames : markFrames + 1,
			heightCm: kind == .flight ? gravity * real * real / 8 * 100 : nil))
	}
	return Analysis(intervals: intervals, outOfSequence: outOfSequence)
}

/// Groups intervals into jumps. A landing that ends one flight may also start the next
/// contact, which is how repeat hops share a touchdown.
public func groupJumps(_ marks: [Mark], _ analysis: Analysis) -> (jumps: [Jump], unpaired: [Mark]) {
	let sorted = sortMarks(marks)
	var flights: [String: Interval] = [:]
	var contacts: [String: Interval] = [:]
	for interval in analysis.intervals {
		if interval.kind == .flight { flights[interval.from.id] = interval } else { contacts[interval.to.id] = interval }
	}
	var jumps: [Jump] = []
	var used = Set<String>()
	for (position, takeoff) in sorted.enumerated() where takeoff.type == .takeoff {
		let flight = flights[takeoff.id]
		let contact = contacts[takeoff.id]
		if flight == nil && contact == nil && position + 1 < sorted.count && sorted[position + 1].type == .takeoff { continue }
		jumps.append(Jump(takeoff: takeoff, landing: flight?.to, contact: contact, flight: flight))
		used.insert(takeoff.id)
		if let contact { used.insert(contact.from.id) }
		if let flight { used.insert(flight.to.id) }
	}
	return (jumps, sorted.filter { !used.contains($0.id) })
}

public func unpairedReason(_ marks: [Mark], _ mark: Mark) -> UnpairedReason {
	let sorted = sortMarks(marks)
	guard let position = sorted.firstIndex(where: { $0.id == mark.id }) else { return .alone }
	let neighbours = [position > 0 ? sorted[position - 1] : nil, position + 1 < sorted.count ? sorted[position + 1] : nil]
	return neighbours.contains { $0?.type == mark.type } ? .outOfSequence : .alone
}

/// Reactive strength index: jump height in metres over the contact before the jump.
public func rsi(_ jump: Jump) -> Double? {
	guard let height = jump.flight?.heightCm, let contact = jump.contact else { return nil }
	return height / 100 / contact.realSeconds
}

// MARK: - Jump units

/// A jump as the workspace shows it: its plant step, takeoff and landing. A jump being marked
/// can have its plant before it has a takeoff. IDs are derived from the marks.
public struct JumpUnit: Identifiable, Sendable {
	public var id: String
	public var plant: Mark?
	public var takeoff: Mark?
	public var landing: Mark?
	public var flight: Interval?
	public var contact: Interval?

	public var marks: [Mark] { [plant, takeoff, landing].compactMap { $0 } }
}

public func jumpUnits(_ marks: [Mark], _ analysis: Analysis) -> [JumpUnit] {
	var units = groupJumps(marks, analysis).jumps.map {
		JumpUnit(id: $0.takeoff.id, plant: $0.contact?.from, takeoff: $0.takeoff, landing: $0.landing, flight: $0.flight, contact: $0.contact)
	}
	let sorted = sortMarks(marks)
	if let last = sorted.last, last.type == .landing, sorted.dropLast().last?.type != .takeoff {
		units.append(JumpUnit(id: last.id, plant: last))
	}
	return units
}

public func unpairedMarks(_ marks: [Mark], _ units: [JumpUnit]) -> [Mark] {
	let used = Set(units.flatMap { $0.marks.map(\.id) })
	return marks.filter { !used.contains($0.id) }
}

public func bestUnit(_ units: [JumpUnit]) -> JumpUnit? {
	units.filter { $0.flight != nil }.reduce(nil as JumpUnit?) { best, unit in
		guard let best else { return unit }
		return unit.flight!.realSeconds > best.flight!.realSeconds ? unit : best
	}
}

/// "Best", "Joint best" or "", comparing at the precision displayed to the athlete.
public func bestFlightLabel(_ unit: JumpUnit, completed: [JumpUnit], best: JumpUnit?) -> String {
	guard let bestFlight = best?.flight, let flight = unit.flight else { return "" }
	let longest = (bestFlight.realSeconds * 1000).rounded()
	if (flight.realSeconds * 1000).rounded() != longest { return "" }
	let ties = completed.filter { $0.flight.map { ($0.realSeconds * 1000).rounded() == longest } ?? false }.count
	return ties > 1 ? "Joint best" : "Best"
}

public func averageFlight(_ units: [JumpUnit]) -> Double? {
	let flights = units.compactMap { $0.flight?.realSeconds }
	return flights.isEmpty ? nil : flights.reduce(0, +) / Double(flights.count)
}

/// The jump the playhead is in, or the last one it has passed. Before the first jump, the first.
public func unitAt(_ units: [JumpUnit], frame: Int, timing: Timing) -> JumpUnit? {
	units.last { unit in
		guard let first = unit.marks.first else { return false }
		return timing.frame(ofMarkTime: first.time) <= frame
	} ?? units.first
}
