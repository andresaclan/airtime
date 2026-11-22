import Foundation

/// The portable export file, byte-compatible in meaning with the web app's
/// (`src/lib/session/exportFile.ts`): either app imports the other's backups.
public let exportFormat = "airtime-export"

private let about =
	"Jump timings marked by hand, frame by frame, on videos in Airtime. Each session is one video. "
	+ "Marks are the source data; everything under \"derived\", \"tables\" and \"overview\" is computed "
	+ "from them and can be recomputed. For analysis across sessions, start with \"tables\": flat rows "
	+ "that load directly into a dataframe or chart. Sessions are ordered by recordedAt, oldest first."

private let fields: KeyValuePairs<String, String> = [
	"sessions[].marks[].seconds": "Media time of the mark in seconds (source of truth). Snapped to a frame boundary.",
	"sessions[].marks[].frame": "Frame index, derived as round(seconds × frameRate.value).",
	"sessions[].marks[].type": "\"takeoff\" = last frame a toe still touches the ground; \"landing\" = first frame the feet touch down.",
	"sessions[].frameRate": "Frames per second used for frame math. source: \"container\" = read from the file, \"playback-estimate\" = measured during playback, \"default\" = 30 fps assumed by an older version of Airtime because the frame rate could not be read or measured.",
	"sessions[].jumpType": "What kind of jump the session holds, one per session: \"approach\", \"drop-jump\" or \"repeat-hops\". null = not set: saved before jump types existed, or with a type that is no longer offered. Compare like with like. An approach jump's contact is its plant step.",
	"sessions[].timeScale": "Real seconds per media second. 1 = real-time footage; 0.25 = 4× slow motion.",
	"sessions[].derived.intervals[]": "Consecutive takeoff→landing pairs are \"flight\", landing→takeoff pairs are \"contact\". A flight runs from the takeoff frame (the last on the floor) to the landing frame (frames = landing frame − takeoff frame). A contact runs from its landing frame to the first frame in the air, the one after the takeoff (frames = takeoff frame − landing frame + 1), so the takeoff frame counts in both. seconds = media time; realSeconds = seconds × timeScale.",
	"sessions[].derived.intervals[].heightCm": "Jump height from flight time, h = g·t²/8 with g = 9.81 m/s² and t = realSeconds. Assumes takeoff and landing at the same height.",
	"sessions[].derived.precisionMs": "Real-time duration of one frame; each mark is accurate to about ±1 frame.",
	"sessions[].derived.jumps[]": "One per takeoff: the flight after it and the contact before it, when there is one. incomplete = no landing marked after the takeoff yet. rsi = heightCm / 100 / contact realSeconds.",
	"sessions[].derived.unpairedMarks[]": "Marks that are part of no flight or contact. reason: \"out-of-sequence\" = next to a mark of the same type, such as two takeoffs in a row; \"alone\" = no mark next to it to pair with.",
	"tables.intervals[]": "One row per flight or contact interval across every session, with session context repeated on each row. index = 1-based position among intervals of the same kind within its session.",
	"tables.jumps[]": "One row per jump across every session, with session context repeated on each row. index = 1-based position of the jump within its session.",
	"tables.sessions[]": "One row per session with its summary statistics.",
	"tables.*[].jumpType": "The owning session's jumpType, repeated on every row.",
	"recordedAt": "When the video was recorded. Starts as the video file's last-modified time and may have been corrected by hand.",
	"overview": "Totals and extremes across all exported sessions.",
]

private func round(_ value: Double, _ digits: Int) -> Double {
	let factor = pow(10, Double(digits))
	return (value * factor).rounded() / factor
}

private func mean(_ values: [Double], _ digits: Int) -> Double? {
	values.isEmpty ? nil : round(values.reduce(0, +) / Double(values.count), digits)
}

/// JSON with keys in insertion order; Foundation's encoder keeps the order they're added in.
private struct OrderedObject: Encodable {
	var entries: [(String, any Encodable)] = []
	mutating func set(_ key: String, _ value: (any Encodable)?) { entries.append((key, NullOr(value))) }

	struct Key: CodingKey {
		var stringValue: String
		var intValue: Int? { nil }
		init(_ s: String) { stringValue = s }
		init?(stringValue: String) { self.stringValue = stringValue }
		init?(intValue: Int) { nil }
	}
	func encode(to encoder: Encoder) throws {
		var c = encoder.container(keyedBy: Key.self)
		for (key, value) in entries { try c.encode(value, forKey: Key(key)) }
	}
}

private struct NullOr: Encodable {
	let value: (any Encodable)?
	init(_ value: (any Encodable)?) { self.value = value }
	func encode(to encoder: Encoder) throws {
		if let value { try value.encode(to: encoder) } else {
			var c = encoder.singleValueContainer()
			try c.encodeNil()
		}
	}
}

private struct ExportedSession {
	var session: Session
	var object: OrderedObject
	var intervals: [Interval]
	var jumps: [OrderedObject]
	var jumpRows: [[(String, (any Encodable)?)]]
	var summary: [(String, (any Encodable)?)]
	var precisionMs: Double
	var unpairedCount: Int
	var flights: [Interval]
	var contacts: [Interval]
}

private func exportSession(_ session: Session) -> ExportedSession {
	let fps = session.frameRate.value
	let timing = Timing.rate(fps)
	let marks = sortMarks(session.marks)
	let analysis = analyzeMarks(marks, timing: timing, timeScale: session.timeScale, jumpType: session.jumpType)
	let flights = analysis.intervals.filter { $0.kind == .flight }
	let contacts = analysis.intervals.filter { $0.kind == .contact }
	let heights = flights.map { $0.heightCm ?? 0 }
	let grouped = groupJumps(marks, analysis)
	let precision = round(1000 / fps * session.timeScale, 2)

	let intervals: [OrderedObject] = analysis.intervals.map { i in
		var o = OrderedObject()
		o.set("kind", i.kind.rawValue)
		o.set("fromMarkId", i.from.id)
		o.set("toMarkId", i.to.id)
		o.set("startSeconds", round(i.from.time, 4))
		o.set("endSeconds", round(i.to.time, 4))
		o.set("frames", i.frames)
		o.set("seconds", round(i.seconds, 4))
		o.set("realSeconds", round(i.realSeconds, 4))
		if let h = i.heightCm { o.set("heightCm", round(h, 1)) }
		return o
	}
	var jumps: [OrderedObject] = []
	var jumpRows: [[(String, (any Encodable)?)]] = []
	for (n, jump) in grouped.jumps.enumerated() {
		let fields: [(String, (any Encodable)?)] = [
			("index", n + 1),
			("takeoffSeconds", round(jump.takeoff.time, 4)),
			("incomplete", jump.flight == nil),
			("flightFrames", jump.flight?.frames),
			("flightRealSeconds", jump.flight.map { round($0.realSeconds, 4) }),
			("contactFrames", jump.contact?.frames),
			("contactRealSeconds", jump.contact.map { round($0.realSeconds, 4) }),
			("heightCm", jump.flight?.heightCm.map { round($0, 1) }),
			("rsi", rsi(jump).map { round($0, 2) }),
		]
		var o = OrderedObject()
		o.set("index", n + 1)
		o.set("takeoffMarkId", jump.takeoff.id)
		o.set("landingMarkId", jump.landing?.id)
		o.set("contactStartMarkId", jump.contact?.from.id)
		for (key, value) in fields.dropFirst() { o.set(key, value) }
		jumps.append(o)
		jumpRows.append(fields)
	}
	let summary: [(String, (any Encodable)?)] = [
		("flightCount", flights.count),
		("contactCount", contacts.count),
		("bestHeightCm", heights.max().map { round($0, 1) }),
		("meanHeightCm", mean(heights, 1)),
		("meanFlightRealSeconds", mean(flights.map(\.realSeconds), 4)),
		("meanContactRealSeconds", mean(contacts.map(\.realSeconds), 4)),
	]

	var derived = OrderedObject()
	derived.set("intervals", intervals)
	derived.set("jumps", jumps)
	derived.set("unpairedMarks", grouped.unpaired.map { mark -> OrderedObject in
		var o = OrderedObject()
		o.set("markId", mark.id)
		o.set("reason", unpairedReason(marks, mark).rawValue)
		return o
	})
	derived.set("precisionMs", precision)
	var summaryObject = OrderedObject()
	for (key, value) in summary { summaryObject.set(key, value) }
	derived.set("summary", summaryObject)

	var o = OrderedObject()
	o.set("schemaVersion", schemaVersion)
	o.set("id", session.id)
	o.set("title", session.title)
	o.set("notes", session.notes)
	o.set("jumpType", session.jumpType?.rawValue)
	o.set("createdAt", session.createdAt)
	o.set("updatedAt", session.updatedAt)
	o.set("recordedAt", session.recordedAt)
	o.set("media", session.media)
	o.set("frameRate", session.frameRate)
	o.set("timeScale", session.timeScale)
	o.set("marks", marks.map { mark -> OrderedObject in
		var m = OrderedObject()
		m.set("id", mark.id)
		m.set("type", mark.type.rawValue)
		m.set("seconds", round(mark.time, 6))
		m.set("frame", timing.frame(ofMarkTime: mark.time))
		return m
	})
	o.set("derived", derived)
	return ExportedSession(
		session: session, object: o, intervals: analysis.intervals, jumps: jumps, jumpRows: jumpRows, summary: summary,
		precisionMs: precision, unpairedCount: grouped.unpaired.count, flights: flights, contacts: contacts)
}

/// The export file's JSON, sessions oldest first.
public func buildExport(_ sessions: [Session], exportedAt: String = ISODate.now()) throws -> Data {
	let exported = sessions.sorted { $0.recordedAt < $1.recordedAt }.map(exportSession)

	var sessionRows: [OrderedObject] = []
	var jumpRows: [OrderedObject] = []
	var intervalRows: [OrderedObject] = []
	for e in exported {
		let s = e.session
		var row = OrderedObject()
		row.set("sessionId", s.id)
		row.set("title", s.title)
		row.set("notes", s.notes)
		row.set("recordedAt", s.recordedAt)
		row.set("savedAt", s.updatedAt)
		row.set("fileName", s.media.fileName)
		row.set("jumpType", s.jumpType?.rawValue)
		row.set("frameRate", s.frameRate.value)
		row.set("frameRateSource", s.frameRate.source.rawValue)
		row.set("timeScale", s.timeScale)
		row.set("markCount", s.marks.count)
		row.set("jumpCount", e.jumps.count)
		row.set("unpairedMarkCount", e.unpairedCount)
		for (key, value) in e.summary { row.set(key, value) }
		sessionRows.append(row)

		func context(_ o: inout OrderedObject, title: String = "sessionTitle") {
			o.set("sessionId", s.id)
			o.set(title, s.title)
			o.set("recordedAt", s.recordedAt)
			o.set("fileName", s.media.fileName)
			o.set("jumpType", s.jumpType?.rawValue)
		}
		for fields in e.jumpRows {
			var j = OrderedObject()
			context(&j)
			j.set("frameRate", s.frameRate.value)
			j.set("frameRateSource", s.frameRate.source.rawValue)
			j.set("timeScale", s.timeScale)
			j.set("precisionMs", e.precisionMs)
			for (key, value) in fields { j.set(key, value) }
			jumpRows.append(j)
		}
		var counts: [IntervalKind: Int] = [:]
		for i in e.intervals {
			counts[i.kind, default: 0] += 1
			var r = OrderedObject()
			context(&r)
			r.set("kind", i.kind.rawValue)
			r.set("index", counts[i.kind]!)
			r.set("startSeconds", round(i.from.time, 4))
			r.set("frames", i.frames)
			r.set("seconds", round(i.seconds, 4))
			r.set("realSeconds", round(i.realSeconds, 4))
			r.set("heightCm", i.heightCm.map { round($0, 1) })
			r.set("frameRate", s.frameRate.value)
			r.set("frameRateSource", s.frameRate.source.rawValue)
			r.set("timeScale", s.timeScale)
			r.set("precisionMs", e.precisionMs)
			intervalRows.append(r)
		}
	}

	let allFlights = exported.flatMap { e in e.flights.map { (e.session, $0) } }
	let allContacts = exported.flatMap(\.contacts)
	let best = allFlights.reduce(nil as (Session, Interval)?) { top, row in
		guard let top else { return row }
		return round(row.1.heightCm ?? 0, 1) > round(top.1.heightCm ?? 0, 1) ? row : top
	}
	var overview = OrderedObject()
	overview.set("sessionCount", exported.count)
	overview.set("flightCount", allFlights.count)
	overview.set("contactCount", allContacts.count)
	overview.set("firstRecordedAt", exported.first?.session.recordedAt)
	overview.set("lastRecordedAt", exported.last?.session.recordedAt)
	overview.set("bestHeight", best.map { session, flight -> OrderedObject in
		var o = OrderedObject()
		o.set("heightCm", round(flight.heightCm ?? 0, 1))
		o.set("sessionId", session.id)
		o.set("sessionTitle", session.title)
		return o
	})
	overview.set("meanHeightCm", mean(allFlights.map { round($0.1.heightCm ?? 0, 1) }, 1))
	overview.set("meanFlightRealSeconds", mean(allFlights.map { round($0.1.realSeconds, 4) }, 4))
	overview.set("meanContactRealSeconds", mean(allContacts.map { round($0.realSeconds, 4) }, 4))
	overview.set("assumedFrameRateSessionIds", exported.filter { $0.session.frameRate.source == .default }.map(\.session.id))

	var fieldsObject = OrderedObject()
	for (key, value) in fields { fieldsObject.set(key, value) }
	var tables = OrderedObject()
	tables.set("sessions", sessionRows)
	tables.set("jumps", jumpRows)
	tables.set("intervals", intervalRows)

	var root = OrderedObject()
	root.set("format", exportFormat)
	root.set("schemaVersion", schemaVersion)
	root.set("exportedAt", exportedAt)
	root.set("about", about)
	root.set("fields", fieldsObject)
	root.set("overview", overview)
	root.set("tables", tables)
	root.set("sessions", exported.map(\.object))

	let encoder = JSONEncoder()
	encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
	return try encoder.encode(root)
}

public func exportFileName(_ sessions: [Session], now: Date = Date()) -> String {
	let date = String(ISODate.string(now).prefix(10))
	if sessions.count != 1 { return "airtime-all-\(date).json" }
	var slug = ""
	var lastDash = false
	for ch in sessions[0].title.lowercased() {
		if ch.isASCII && (ch.isLetter || ch.isNumber) {
			slug.append(ch)
			lastDash = false
		} else if !lastDash {
			slug.append("-")
			lastDash = true
		}
	}
	slug = String(slug.trimmingCharacters(in: CharacterSet(charactersIn: "-")).prefix(60))
	return "airtime-\(slug.isEmpty ? "session" : slug)-\(date).json"
}

// MARK: - Import

public struct ImportError: LocalizedError, Equatable {
	public var message: String
	public init(_ message: String) { self.message = message }
	public var errorDescription: String? { message }
}

private typealias Json = [String: Any]

private func expect(_ condition: Bool, _ message: @autoclosure () -> String) throws {
	if !condition { throw ImportError(message()) }
}

private func str(_ object: Json, _ key: String, _ at: String) throws -> String {
	guard let value = object[key] as? String else { throw ImportError("\(at).\(key) must be a string") }
	return value
}

private func num(_ object: Json, _ key: String, _ at: String) throws -> Double {
	guard let value = object[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else {
		throw ImportError("\(at).\(key) must be a finite number")
	}
	return value.doubleValue
}

/// Upgrades a session written by an older version (`src/lib/session/migrate.ts`). Never edit a
/// released step: exports made by that version still depend on it.
func migrateSession(_ raw: [String: Any]) throws -> [String: Any] {
	var version = (raw["schemaVersion"] as? NSNumber)?.doubleValue ?? 1
	guard version == version.rounded(), version >= 1, version < 1_000_000 else {
		throw ImportError("Unrecognised schema version \(raw["schemaVersion"] ?? "")")
	}
	if Int(version) > schemaVersion {
		throw ImportError("Saved by a newer version of Airtime (schema \(Int(version))). Update the app.")
	}
	var session = raw
	while Int(version) < schemaVersion {
		switch Int(version) {
		case 1: session["recordedAt"] = (session["media"] as? Json)?["lastModified"] ?? NSNull()
		case 2: session["jumpType"] = NSNull()
		case 3: break
		case 4:
			let map: [String: String] = ["approach": "approach", "drop": "drop-jump", "rebound": "repeat-hops"]
			session["jumpType"] = (session["jumpType"] as? String).flatMap { map[$0] } ?? NSNull()
		default: throw ImportError("No migration from schema version \(Int(version))")
		}
		version += 1
		session["schemaVersion"] = Int(version)
	}
	return session
}

private func parseSession(_ raw: Any, _ index: Int) throws -> Session {
	let at = "sessions[\(index)]"
	guard let raw = raw as? Json else { throw ImportError("\(at) must be an object") }
	guard let media = raw["media"] as? Json else { throw ImportError("\(at).media must be an object") }
	guard let frameRate = raw["frameRate"] as? Json else { throw ImportError("\(at).frameRate must be an object") }
	guard let marks = raw["marks"] as? [Any] else { throw ImportError("\(at).marks must be an array") }
	let fps = try num(frameRate, "value", "\(at).frameRate")
	try expect(fps > 0 && fps <= 1000, "\(at).frameRate.value is out of range")
	guard let source = FrameRateSource(rawValue: try str(frameRate, "source", "\(at).frameRate")) else {
		throw ImportError("\(at).frameRate.source is not recognised")
	}
	let timeScale = try num(raw, "timeScale", at)
	try expect(timeScale > 0 && timeScale <= 1, "\(at).timeScale must be between 0 and 1")
	var jumpType: JumpType?
	if let value = raw["jumpType"], !(value is NSNull) {
		guard let text = value as? String, let type = JumpType(rawValue: text) else { throw ImportError("\(at).jumpType is not recognised") }
		jumpType = type
	}
	let parsedMarks = try marks.enumerated().map { markIndex, mark -> Mark in
		let markAt = "\(at).marks[\(markIndex)]"
		guard let mark = mark as? Json else { throw ImportError("\(markAt) must be an object") }
		guard let type = MarkType(rawValue: try str(mark, "type", markAt)) else { throw ImportError("\(markAt).type is not recognised") }
		let seconds = try num(mark, "seconds", markAt)
		try expect(seconds >= 0, "\(markAt).seconds must not be negative")
		return Mark(id: try str(mark, "id", markAt), type: type, time: seconds)
	}
	let m = "\(at).media"
	return Session(
		id: try str(raw, "id", at), title: try str(raw, "title", at), notes: try str(raw, "notes", at), jumpType: jumpType,
		createdAt: try str(raw, "createdAt", at), updatedAt: try str(raw, "updatedAt", at), recordedAt: try str(raw, "recordedAt", at),
		media: SessionMedia(
			fileName: try str(media, "fileName", m), mimeType: try str(media, "mimeType", m), sizeBytes: try num(media, "sizeBytes", m),
			lastModified: try str(media, "lastModified", m), durationSeconds: try num(media, "durationSeconds", m),
			width: try num(media, "width", m), height: try num(media, "height", m), fingerprint: try str(media, "fingerprint", m)),
		frameRate: FrameRate(value: fps, source: source), timeScale: timeScale, marks: sortMarks(parsedMarks))
}

/// Parses an Airtime export file from this or any earlier version, from either app. Derived
/// values are ignored; they're recomputed from marks.
public func parseImport(_ data: Data) throws -> [Session] {
	guard let object = try? JSONSerialization.jsonObject(with: data) else { throw ImportError("Not a valid JSON file") }
	guard let root = object as? Json, root["format"] as? String == exportFormat else { throw ImportError("Not an Airtime export file") }
	guard let sessions = root["sessions"] as? [Any] else { throw ImportError("sessions must be an array") }
	return try sessions.enumerated().map { index, raw in
		guard var session = raw as? Json else { throw ImportError("sessions[\(index)] must be an object") }
		// Sessions carry their own version; the file's covers any that don't.
		if session["schemaVersion"] == nil, let fileVersion = root["schemaVersion"] { session["schemaVersion"] = fileVersion }
		return try parseSession(try migrateSession(session), index)
	}
}

/// Each video has exactly one session. An import never adds a second session for a video that
/// already has one stored (it's skipped, and the stored one kept), and of several in the file
/// for one video only the newest comes in. Both apps saving the same video before an import
/// is how two would otherwise meet.
public func oneSessionPerVideo(_ incoming: [Session], existing: [Session]) -> [Session] {
	let stored = Dictionary(existing.map { ($0.media.fingerprint, $0.id) }, uniquingKeysWith: { a, _ in a })
	var newest: [String: Session] = [:]
	for session in incoming {
		let fingerprint = session.media.fingerprint
		if let id = stored[fingerprint], id != session.id { continue }
		if let other = newest[fingerprint], other.updatedAt >= session.updatedAt { continue }
		newest[fingerprint] = session
	}
	// The chosen record itself, not every record sharing its id.
	return incoming.filter { session in newest[session.media.fingerprint].map { $0.id == session.id && $0.updatedAt == session.updatedAt } ?? false }
		.reduce(into: [Session]()) { kept, session in if !kept.contains(where: { $0.id == session.id }) { kept.append(session) } }
}

/// Imported sessions that are new or newer than what's stored; the rest are skipped.
public func sessionsToImport(_ incoming: [Session], existing: [Session]) -> [Session] {
	let stored = Dictionary(existing.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
	return incoming.filter { session in
		guard let current = stored[session.id] else { return true }
		return session.updatedAt > current.updatedAt
	}
}
