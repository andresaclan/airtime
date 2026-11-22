import Foundation

/// Saved sessions, drafts and where each video lives, as plain JSON files under one folder
/// (by default `~/Library/Application Support/Airtime`). Nothing here can be cleared by a
/// browser, and Time Machine backs it up with everything else.
///
/// - `sessions/<id>.json`: one saved session per file, in the export schema.
/// - `drafts/<hash>.json`: unsaved work, one per video.
/// - `library.json`: video locations by fingerprint, and the folders searched for missing videos.
public final class Store: @unchecked Sendable {
	public let root: URL
	private let fm = FileManager.default
	private let encoder: JSONEncoder = {
		let e = JSONEncoder()
		e.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
		return e
	}()

	public struct LibraryFile: Codable, Equatable, Sendable {
		public var locations: [String: VideoLocation] = [:]
		public var folders: [String] = []
		public init() {}
	}

	public static var defaultRoot: URL {
		if let override = ProcessInfo.processInfo.environment["AIRTIME_DATA_DIR"] { return URL(fileURLWithPath: override) }
		return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Airtime")
	}

	public init(root: URL = Store.defaultRoot) {
		self.root = root
		for dir in ["sessions", "drafts"] {
			try? fm.createDirectory(at: root.appendingPathComponent(dir), withIntermediateDirectories: true)
		}
	}

	private var sessionsDir: URL { root.appendingPathComponent("sessions") }
	private var draftsDir: URL { root.appendingPathComponent("drafts") }
	private var libraryURL: URL { root.appendingPathComponent("library.json") }

	private func fileName(_ key: String) -> String {
		// IDs are UUIDs; fingerprints carry a "sha256:" prefix that isn't a safe file name.
		key.map { $0.isLetter || $0.isNumber || $0 == "-" ? String($0) : "_" }.joined() + ".json"
	}

	private func write<T: Encodable>(_ value: T, to url: URL) throws {
		try encoder.encode(value).write(to: url, options: .atomic)
	}

	// MARK: Sessions

	public struct ReadResult: Sendable {
		public var sessions: [Session]
		/// Files this version can't read (saved by a newer Airtime, or damaged); never overwritten.
		public var unreadable: [URL]
	}

	public func readSessions() -> ReadResult {
		var sessions: [Session] = []
		var unreadable: [URL] = []
		let files = (try? fm.contentsOfDirectory(at: sessionsDir, includingPropertiesForKeys: nil)) ?? []
		for file in files where file.pathExtension == "json" {
			guard let data = try? Data(contentsOf: file),
				let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
				let migrated = try? migrateSession(object),
				let session = try? JSONDecoder().decode(Session.self, from: JSONSerialization.data(withJSONObject: migrated))
			else {
				unreadable.append(file)
				continue
			}
			sessions.append(session)
		}
		return ReadResult(sessions: sessions.sorted { $0.updatedAt > $1.updatedAt }, unreadable: unreadable)
	}

	public func put(_ session: Session) throws {
		try write(session, to: sessionsDir.appendingPathComponent(fileName(session.id)))
	}

	public func delete(sessionId: String) {
		try? fm.removeItem(at: sessionsDir.appendingPathComponent(fileName(sessionId)))
	}

	public func session(fingerprint: String) -> Session? {
		readSessions().sessions.first { $0.media.fingerprint == fingerprint }
	}

	/// Merges an export file; the newer copy of each session wins.
	public func importBackup(_ data: Data) throws -> (imported: Int, skipped: Int) {
		let incoming = try parseImport(data)
		let stored = readSessions()
		let unreadableIds = Set(stored.unreadable.map { $0.deletingPathExtension().lastPathComponent })
		let toImport = oneSessionPerVideo(
			sessionsToImport(incoming, existing: stored.sessions).filter { !unreadableIds.contains(fileName($0.id).replacingOccurrences(of: ".json", with: "")) },
			existing: stored.sessions)
		for session in toImport { try put(session) }
		return (toImport.count, incoming.count - toImport.count)
	}

	// MARK: Drafts

	public func draft(fingerprint: String) -> Draft? {
		guard let data = try? Data(contentsOf: draftsDir.appendingPathComponent(fileName(fingerprint))) else { return nil }
		return try? JSONDecoder().decode(Draft.self, from: data)
	}

	public func drafts() -> [Draft] {
		let files = (try? fm.contentsOfDirectory(at: draftsDir, includingPropertiesForKeys: nil)) ?? []
		return files.compactMap { try? JSONDecoder().decode(Draft.self, from: Data(contentsOf: $0)) }
			.sorted { $0.updatedAt > $1.updatedAt }
	}

	@discardableResult
	public func setDraft(_ draft: Draft?, fingerprint: String) -> Bool {
		let url = draftsDir.appendingPathComponent(fileName(fingerprint))
		guard let draft else {
			try? fm.removeItem(at: url)
			return true
		}
		return (try? write(draft, to: url)) != nil
	}

	// MARK: Library

	public func library() -> LibraryFile {
		guard let data = try? Data(contentsOf: libraryURL), let file = try? JSONDecoder().decode(LibraryFile.self, from: data) else { return LibraryFile() }
		return file
	}

	public func updateLibrary(_ change: (inout LibraryFile) -> Void) {
		var file = library()
		change(&file)
		try? write(file, to: libraryURL)
	}

	public func remember(_ url: URL, fingerprint: String, sizeBytes: Double) {
		updateLibrary { $0.locations[fingerprint] = VideoLocation(url: url, sizeBytes: sizeBytes) }
	}

	/// The video for a fingerprint: where it was last opened, or found in a video folder (and
	/// remembered there). Nil when it can't be found.
	public func locateVideo(fingerprint: String, sizeBytes: Double, extraFolders: [URL] = []) -> URL? {
		let file = library()
		// Same size isn't enough: a different video can replace the one that was there.
		if let url = file.locations[fingerprint]?.resolve(),
			let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, Double(size) == sizeBytes,
			(try? fingerprintFile(url)) == fingerprint
		{
			if url.path != file.locations[fingerprint]?.path { remember(url, fingerprint: fingerprint, sizeBytes: sizeBytes) }
			return url
		}
		var folders = file.folders.map { URL(fileURLWithPath: $0) } + extraFolders
		if let last = file.locations[fingerprint] { folders.insert(URL(fileURLWithPath: last.path).deletingLastPathComponent(), at: 0) }
		guard let found = findVideo(fingerprint: fingerprint, sizeBytes: sizeBytes, in: folders) else { return nil }
		remember(found, fingerprint: fingerprint, sizeBytes: sizeBytes)
		return found
	}
}
