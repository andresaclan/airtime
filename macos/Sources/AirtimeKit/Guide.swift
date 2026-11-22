import Foundation

/// What to mark next: the step a jump needs at the frame on screen, and the name each mark goes
/// by. Ported from `src/lib/video/guide.ts`.
public enum MarkStep: String, Sendable, CaseIterable {
	case plant
	case takeoff
	case landing

	/// The mark type each step is stored as. The plant step is a landing: the foot touches down.
	public var markType: MarkType { self == .takeoff ? .takeoff : .landing }

	public func label(_ jumpType: JumpType?) -> String {
		switch self {
		case .plant: plantLabel(jumpType)
		case .takeoff: "Takeoff"
		case .landing: "Landing"
		}
	}

	/// Which frame a step is, as the hint says it.
	public func definition(_ jumpType: JumpType?) -> String {
		switch self {
		case .takeoff: return "Last frame a toe still touches the ground."
		case .landing: return "First frame your feet touch back down."
		case .plant:
			if jumpType == .dropJump { return "First frame your feet touch the ground after the box." }
			if jumpType == .repeatHops { return "First frame your feet touch down before the first hop." }
			return "First frame your plant foot touches the ground."
		}
	}
}

public func plantLabel(_ jumpType: JumpType?) -> String {
	switch jumpType {
	case .dropJump: "Box landing"
	case .repeatHops: "Touchdown"
	default: "Plant step"
	}
}

/// The step a mark is: a landing straight after a takeoff ends a flight; any other starts a contact.
private func stepAt(_ sorted: [Mark], _ index: Int) -> MarkStep {
	if sorted[index].type == .takeoff { return .takeoff }
	return index > 0 && sorted[index - 1].type == .takeoff ? .landing : .plant
}

private func stepAfter(_ sorted: [Mark], _ index: Int, _ jumpType: JumpType?) -> MarkStep {
	if index < 0 { return .plant }
	switch stepAt(sorted, index) {
	case .takeoff: return .landing
	case .plant: return .takeoff
	// A landing ends the jump. Repeat hops reuse it as the next hop's touchdown.
	case .landing: return jumpType == .repeatHops ? .takeoff : .plant
	}
}

/// What marking does at a frame, worked out from the marks around it.
public enum MarkAction: Equatable, Sendable {
	/// The step that belongs here.
	case add(MarkStep)
	/// A mark is already on this frame.
	case onFrame(MarkStep, Mark)
	/// Nothing obviously belongs here; the athlete picks the type.
	case choose
}

public func markAction(_ marks: [Mark], frame: Int, timing: Timing, jumpType: JumpType?) -> MarkAction {
	let sorted = sortMarks(marks)
	let frames = sorted.map { timing.frame(ofMarkTime: $0.time) }
	if let on = frames.firstIndex(of: frame) { return .onFrame(stepAt(sorted, on), sorted[on]) }
	let next = frames.firstIndex { $0 > frame }
	let prev = (next ?? sorted.count) - 1
	let step = stepAfter(sorted, prev, jumpType)
	if let next, sorted[next].type == step.markType { return .choose }
	return .add(step)
}

/// The step a placed mark is, for naming it.
public func markStep(_ marks: [Mark], _ mark: Mark) -> MarkStep {
	let sorted = sortMarks(marks)
	guard let index = sorted.firstIndex(where: { $0.id == mark.id }) else {
		return mark.type == .takeoff ? .takeoff : .landing
	}
	return stepAt(sorted, index)
}

/// The hint retires itself once the athlete has measured this many jumps.
public let hintRetiresAfter = 3
