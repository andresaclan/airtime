import Foundation

/// Flight and contact time across saved sessions (`src/lib/session/trends.ts`). Each session is
/// one point on its recorded date: its best jump, with every other completed jump beside it.
public struct TrendJump: Equatable, Sendable {
	public var flightMs: Double
	/// The contact before the jump; nil when it has none.
	public var contactMs: Double?
}

public struct TrendPoint: Identifiable, Sendable {
	public var session: Session
	public var date: Date
	public var best: TrendJump
	public var jumps: [TrendJump]
	public var id: String { session.id }
}

public struct TrendGroup: Identifiable, Sendable {
	public var jumpType: JumpType?
	public var label: String
	public var showContact: Bool
	/// Oldest first.
	public var points: [TrendPoint]
	public var id: String { jumpType?.rawValue ?? "none" }
}

private func completedJumps(_ session: Session) -> [(flight: Interval, contact: Interval?)] {
	let marks = sortMarks(session.marks)
	let analysis = analyzeMarks(marks, timing: session.savedTiming, timeScale: session.timeScale, jumpType: session.jumpType)
	return groupJumps(marks, analysis).jumps.compactMap { jump in jump.flight.map { ($0, jump.contact) } }
}

private func trendJump(_ flight: Interval, _ contact: Interval?) -> TrendJump {
	TrendJump(flightMs: flight.realSeconds * 1000, contactMs: contact.map { $0.realSeconds * 1000 })
}

/// How many completed jumps a session has, and its longest flight.
public func sessionSummary(_ session: Session) -> (jumps: Int, bestFlightMs: Double?) {
	let jumps = completedJumps(session)
	return (jumps.count, jumps.map { $0.flight.realSeconds * 1000 }.max())
}

public func trendPoint(_ session: Session) -> TrendPoint? {
	guard let date = ISODate.date(session.recordedAt) else { return nil }
	let completed = completedJumps(session)
	guard var best = completed.first else { return nil }
	for jump in completed.dropFirst() where jump.flight.realSeconds > best.flight.realSeconds { best = jump }
	return TrendPoint(session: session, date: date, best: trendJump(best.flight, best.contact), jumps: completed.map { trendJump($0.flight, $0.contact) })
}

/// One group per jump type that has a session to chart, in menu order; untyped sessions last.
public func trendGroups(_ sessions: [Session]) -> [TrendGroup] {
	var byType: [JumpType?: [TrendPoint]] = [:]
	for session in sessions {
		guard let point = trendPoint(session) else { continue }
		byType[session.jumpType, default: []].append(point)
	}
	let order: [JumpType?] = JumpType.allCases.map { $0 } + [nil]
	return order.compactMap { type in
		guard var points = byType[type] else { return nil }
		points.sort { $0.date < $1.date }
		return TrendGroup(
			jumpType: type, label: type?.label ?? "No jump type",
			showContact: points.contains { $0.jumps.contains { $0.contactMs != nil } }, points: points)
	}
}

/// The group holding the most recently recorded session: the jump type being trained now.
public func latestGroup(_ groups: [TrendGroup]) -> TrendGroup? {
	groups.max { ($0.points.last?.date ?? .distantPast) < ($1.points.last?.date ?? .distantPast) }
}

public struct TrendRange: Identifiable, Sendable, Hashable {
	public var label: String
	public var months: Int?
	public var id: String { label }
}

public let trendRanges: [TrendRange] = [
	.init(label: "3M", months: 3), .init(label: "6M", months: 6), .init(label: "1Y", months: 12), .init(label: "All", months: nil),
]

public func withinMonths(_ points: [TrendPoint], _ months: Int?, now: Date = Date()) -> [TrendPoint] {
	guard let months, let start = Calendar.current.date(byAdding: .month, value: -months, to: now) else { return points }
	return points.filter { $0.date >= start }
}
