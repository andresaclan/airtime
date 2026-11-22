import Foundation

/// A saved marking session for one video, in the web app's schema (`src/lib/session/schema.ts`),
/// so sessions move between the two apps through export files unchanged. The video itself is
/// never stored.
public let schemaVersion = 5

public enum FrameRateSource: String, Codable, Sendable {
	case container
	case playbackEstimate = "playback-estimate"
	case `default`
}

public enum JumpType: String, Codable, Sendable, CaseIterable, Identifiable {
	case approach
	case dropJump = "drop-jump"
	case repeatHops = "repeat-hops"

	public var id: String { rawValue }
	public var label: String {
		switch self {
		case .approach: "Approach"
		case .dropJump: "Drop jump"
		case .repeatHops: "Repeat hops"
		}
	}
}

public let defaultJumpType = JumpType.approach

public struct SessionMedia: Codable, Equatable, Sendable {
	public var fileName: String
	public var mimeType: String
	public var sizeBytes: Double
	/// ISO timestamp of the file's last-modified date.
	public var lastModified: String
	public var durationSeconds: Double
	public var width: Double
	public var height: Double
	/// Identifies the file so opening it again restores this session.
	public var fingerprint: String

	public init(fileName: String, mimeType: String, sizeBytes: Double, lastModified: String, durationSeconds: Double, width: Double, height: Double, fingerprint: String) {
		self.fileName = fileName
		self.mimeType = mimeType
		self.sizeBytes = sizeBytes
		self.lastModified = lastModified
		self.durationSeconds = durationSeconds
		self.width = width
		self.height = height
		self.fingerprint = fingerprint
	}
}

public struct FrameRate: Codable, Equatable, Sendable {
	public var value: Double
	public var source: FrameRateSource
	public init(value: Double, source: FrameRateSource) {
		self.value = value
		self.source = source
	}
}

public struct Session: Codable, Equatable, Sendable, Identifiable {
	public var schemaVersion: Int
	public var id: String
	public var title: String
	public var notes: String
	/// `nil` until the athlete sets one.
	public var jumpType: JumpType?
	public var createdAt: String
	public var updatedAt: String
	/// ISO timestamp of when the video was filmed, as corrected by the athlete.
	public var recordedAt: String
	public var media: SessionMedia
	public var frameRate: FrameRate
	/// Real seconds per media second: 1 for real time, 0.25 for 4× slow motion.
	public var timeScale: Double
	public var marks: [Mark]

	public init(id: String, title: String, notes: String, jumpType: JumpType?, createdAt: String, updatedAt: String, recordedAt: String, media: SessionMedia, frameRate: FrameRate, timeScale: Double, marks: [Mark]) {
		self.schemaVersion = AirtimeKit.schemaVersion
		self.id = id
		self.title = title
		self.notes = notes
		self.jumpType = jumpType
		self.createdAt = createdAt
		self.updatedAt = updatedAt
		self.recordedAt = recordedAt
		self.media = media
		self.frameRate = frameRate
		self.timeScale = timeScale
		self.marks = marks
	}

	enum CodingKeys: String, CodingKey {
		case schemaVersion, id, title, notes, jumpType, createdAt, updatedAt, recordedAt, media, frameRate, timeScale, marks
	}

	// `jumpType` is written as an explicit null, as the web app writes it.
	public func encode(to encoder: Encoder) throws {
		var c = encoder.container(keyedBy: CodingKeys.self)
		try c.encode(schemaVersion, forKey: .schemaVersion)
		try c.encode(id, forKey: .id)
		try c.encode(title, forKey: .title)
		try c.encode(notes, forKey: .notes)
		try c.encode(jumpType, forKey: .jumpType)
		try c.encode(createdAt, forKey: .createdAt)
		try c.encode(updatedAt, forKey: .updatedAt)
		try c.encode(recordedAt, forKey: .recordedAt)
		try c.encode(media, forKey: .media)
		try c.encode(frameRate, forKey: .frameRate)
		try c.encode(timeScale, forKey: .timeScale)
		try c.encode(marks, forKey: .marks)
	}

	/// Timing from the saved frame rate alone, for a session whose video isn't open.
	public var savedTiming: Timing { .rate(frameRate.value) }

	/// The parts the athlete edits. Two sessions with equal signatures hold the same work.
	public var signature: Signature {
		Signature(marks: marks, title: title, notes: notes, jumpType: jumpType, recordedAt: recordedAt, timeScale: timeScale)
	}

	public struct Signature: Equatable, Sendable {
		public var marks: [Mark]
		public var title: String
		public var notes: String
		public var jumpType: JumpType?
		public var recordedAt: String
		public var timeScale: Double

		public init(marks: [Mark], title: String, notes: String, jumpType: JumpType?, recordedAt: String, timeScale: Double) {
			self.marks = marks
			self.title = title
			self.notes = notes
			self.jumpType = jumpType
			self.recordedAt = recordedAt
			self.timeScale = timeScale
		}
	}
}

public struct TimeScaleOption: Sendable, Identifiable {
	public var value: Double
	public var label: String
	public var id: Double { value }
}

public let timeScales: [TimeScaleOption] = [
	.init(value: 1, label: "Real time"),
	.init(value: 0.5, label: "2× slow motion"),
	.init(value: 0.25, label: "4× slow motion"),
	.init(value: 0.125, label: "8× slow motion"),
]

// MARK: - Dates

/// ISO timestamps exactly as JavaScript's `toISOString` writes them.
public enum ISODate {
	nonisolated(unsafe) private static let withFraction: ISO8601DateFormatter = {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return f
	}()
	nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime]
		return f
	}()

	public static func string(_ date: Date) -> String { withFraction.string(from: date) }
	public static func now() -> String { string(Date()) }
	public static func date(_ string: String) -> Date? {
		withFraction.date(from: string) ?? plain.date(from: string)
	}
}

/// "clip60.mp4" → "clip60", the title a new session starts with.
public func defaultTitle(_ fileName: String) -> String {
	// As /\.[^.]+$/ does: the last dot, when something follows it.
	guard let dot = fileName.lastIndex(of: "."), fileName.index(after: dot) != fileName.endIndex else { return fileName }
	return String(fileName[..<dot])
}
