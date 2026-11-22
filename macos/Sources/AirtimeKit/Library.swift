import CryptoKit
import Foundation

/// Cheap identity for a video file, identical to the web app's (`fingerprint.ts`): SHA-256 over
/// its size in decimal, then the first and last 1 MB. Sessions saved in either app match the
/// same file in the other.
public func fingerprintFile(_ url: URL) throws -> String {
	let sample = 1024 * 1024
	let handle = try FileHandle(forReadingFrom: url)
	defer { try? handle.close() }
	let size = Int(try handle.seekToEnd())
	var hasher = SHA256()
	hasher.update(data: Data(String(size).utf8))
	try handle.seek(toOffset: 0)
	hasher.update(data: try handle.read(upToCount: min(sample, size)) ?? Data())
	let tailStart = max(sample, size - sample)
	if tailStart < size {
		try handle.seek(toOffset: UInt64(tailStart))
		hasher.update(data: try handle.read(upToCount: size - tailStart) ?? Data())
	}
	return "sha256:" + hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

/// Unsaved work on one video, kept on disk as it changes so it survives a crash or quit. Not a
/// saved session: it never shows in Sessions, and saving or discarding the edits deletes it.
public struct Draft: Codable, Equatable, Sendable {
	public var fingerprint: String
	public var updatedAt: String
	/// True while the edits have never been saved.
	public var isNew: Bool
	public var session: Session

	public init(session: Session, isNew: Bool, now: String) {
		fingerprint = session.media.fingerprint
		updatedAt = now
		self.isNew = isNew
		self.session = session
	}

	/// Worth offering back on the start screen.
	public var holdsWork: Bool {
		!isNew || !session.marks.isEmpty || session.title != defaultTitle(session.media.fileName) || !session.notes.isEmpty
			|| session.jumpType != defaultJumpType || session.timeScale != 1 || session.recordedAt != session.media.lastModified
	}
}

public enum Restore: Equatable {
	case none
	case saved(Session)
	case draft(Draft, saved: Session?)
}

/// What reopening a video brings back. Unsaved edits win over the saved session.
public func pickRestore(saved: Session?, draft: Draft?) -> (restore: Restore, staleDraft: Bool) {
	if let draft, saved == nil || draft.session.signature != saved!.signature {
		return (.draft(draft, saved: saved), false)
	}
	if let saved { return (.saved(saved), draft != nil) }
	return (.none, false)
}

/// Where a session's video was last seen. A bookmark follows the file when it's moved or
/// renamed on the same volume; the path is the fallback when it can't be resolved.
public struct VideoLocation: Codable, Equatable, Sendable {
	public var path: String
	public var bookmark: Data?
	public var sizeBytes: Double

	public init(url: URL, sizeBytes: Double) {
		path = url.path
		bookmark = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
		self.sizeBytes = sizeBytes
	}

	/// The file's current URL, if it still exists.
	public func resolve() -> URL? {
		if let bookmark {
			var stale = false
			if let url = try? URL(resolvingBookmarkData: bookmark, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale),
				FileManager.default.fileExists(atPath: url.path)
			{
				return url
			}
		}
		return FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
	}
}

public let videoExtensions: Set<String> = ["mp4", "m4v", "mov", "qt", "3gp", "3g2"]

/// Finds a video by fingerprint in `folders`, checking sizes first so only candidates are hashed.
public func findVideo(fingerprint: String, sizeBytes: Double, in folders: [URL]) -> URL? {
	let keys: [URLResourceKey] = [.fileSizeKey, .isRegularFileKey]
	for folder in folders {
		guard let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { continue }
		for case let url as URL in walker where videoExtensions.contains(url.pathExtension.lowercased()) {
			guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true,
				Double(values.fileSize ?? -1) == sizeBytes
			else { continue }
			if (try? fingerprintFile(url)) == fingerprint { return url }
		}
	}
	return nil
}
