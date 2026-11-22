import Foundation
import Testing

@testable import AirtimeKit

/// The port against what the web app's TypeScript computes on the same inputs
/// (`scripts/golden.ts` writes golden.json).
let testsDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let repoRoot = testsDir.appendingPathComponent("../../..").standardizedFileURL

nonisolated(unsafe) let golden: [String: Any] = {
	let data = try! Data(contentsOf: testsDir.appendingPathComponent("golden.json"))
	return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
}()

func timing(named name: String) -> Timing {
	switch name {
	case "rate30": return .rate(30)
	case "rate240": return .rate(240)
	default:
		let videos = golden["videos"] as! [String: [String: Any]]
		let t = videos["src/lib/video/fixtures/vfr-dropped.mp4"]!["timing"] as! [String: Any]
		return Timing(fps: t["fps"] as! Double, frameTimes: t["frameTimes"] as? [Double])
	}
}

@Suite struct Golden {
	@Test func videoTimingAndFingerprints() throws {
		let videos = golden["videos"] as! [String: [String: Any]]
		#expect(videos.count == 17)
		for (path, expected) in videos {
			let url = repoRoot.appendingPathComponent(path)
			#expect(try fingerprintFile(url) == expected["fingerprint"] as? String, "\(path)")
			let parsed = VideoTiming.detect(url)
			guard let t = expected["timing"] as? [String: Any] else {
				#expect(parsed == nil, "\(path)")
				continue
			}
			let timing = try #require(parsed, "\(path)")
			#expect(timing.fps == t["fps"] as? Double, "\(path) fps")
			#expect(abs(timing.analysis.measuredFps - (t["measuredFps"] as! Double)) < 1e-9, "\(path)")
			#expect(timing.analysis.variableFrameRate == t["variableFrameRate"] as? Bool, "\(path)")
			#expect(abs(timing.editGap - (t["editGap"] as! Double)) < 1e-12, "\(path)")
			let times = t["frameTimes"] as! [Double]
			#expect(timing.frameTimes.count == times.count, "\(path)")
			for (a, b) in zip(timing.frameTimes, times) { #expect(abs(a - b) < 1e-12, "\(path)") }
		}
	}

	@Test func marksMatchTheWebApp() {
		let cases = golden["markCases"] as! [[String: Any]]
		#expect(cases.count == 160)
		for (n, c) in cases.enumerated() {
			let t = timing(named: c["timing"] as! String)
			let jumpType = (c["jumpType"] as? String).flatMap(JumpType.init(rawValue:))
			let marks = (c["marks"] as! [[String: Any]]).map {
				Mark(id: $0["id"] as! String, type: MarkType(rawValue: $0["type"] as! String)!, time: $0["time"] as! Double)
			}
			let analysis = analyzeMarks(marks, timing: t, timeScale: 0.5, jumpType: jumpType)
			let intervals = c["intervals"] as! [[String: Any]]
			#expect(analysis.intervals.count == intervals.count, "case \(n)")
			for (a, b) in zip(analysis.intervals, intervals) {
				#expect(a.kind.rawValue == b["kind"] as? String && a.from.id == b["from"] as? String && a.to.id == b["to"] as? String, "case \(n)")
				#expect(abs(a.seconds - (b["seconds"] as! Double)) < 1e-12 && a.frames == b["frames"] as? Int, "case \(n)")
				#expect(abs(a.realSeconds - (b["realSeconds"] as! Double)) < 1e-12, "case \(n)")
			}
			#expect(analysis.outOfSequence.sorted() == c["outOfSequence"] as! [String], "case \(n)")
			let grouped = groupJumps(marks, analysis)
			#expect(grouped.jumps.map(\.takeoff.id) == c["jumps"] as! [String], "case \(n)")
			#expect(grouped.unpaired.map(\.id) == c["unpaired"] as! [String], "case \(n)")
			let units = jumpUnits(marks, analysis).map { [$0.id, $0.plant?.id ?? "-", $0.takeoff?.id ?? "-", $0.landing?.id ?? "-"] }
			let expectedUnits = (c["units"] as! [[String: Any]]).map { u in
				[u["id"] as! String] + ["plant", "takeoff", "landing"].map { u[$0] as? String ?? "-" }
			}
			#expect(units == expectedUnits, "case \(n)")
			let action = c["action"] as! [String: Any]
			let swift = markAction(marks, frame: c["probe"] as! Int, timing: t, jumpType: jumpType)
			switch (swift, action["kind"] as! String) {
			case (.add(let step), "add"): #expect(step.rawValue == action["step"] as? String, "case \(n)")
			case (.onFrame(let step, let mark), "on-frame"):
				#expect(step.rawValue == action["step"] as? String && mark.id == (action["mark"] as! [String: Any])["id"] as? String, "case \(n)")
			case (.choose, "choose"): break
			default: Issue.record("case \(n): \(swift) vs \(action)")
			}
		}
	}

	@Test func exportMatchesTheWebApp() throws {
		let fixture = try Data(contentsOf: repoRoot.appendingPathComponent("src/lib/session/fixtures/export-v3.json"))
		let sessions = try parseImport(fixture)
		let data = try buildExport(sessions, exportedAt: "x")
		var ours = try JSONSerialization.jsonObject(with: data) as! [String: Any]
		var theirs = golden["export"] as! [String: Any]
		ours["exportedAt"] = nil
		theirs["exportedAt"] = nil
		#expect(NSDictionary(dictionary: ours).isEqual(to: theirs))
		if !NSDictionary(dictionary: ours).isEqual(to: theirs) {
			for key in theirs.keys where !NSDictionary(dictionary: [key: ours[key] ?? NSNull()]).isEqual(to: [key: theirs[key]!]) {
				Issue.record("export differs at \(key)")
			}
		}
		// And the file reads back into the same sessions.
		#expect(try parseImport(data) == sessions.sorted { $0.recordedAt < $1.recordedAt })
	}

	@Test func trendsMatchTheWebApp() throws {
		let fixture = try Data(contentsOf: repoRoot.appendingPathComponent("src/lib/session/fixtures/export-v3.json"))
		let groups = trendGroups(try parseImport(fixture))
		let expected = golden["trends"] as! [[String: Any]]
		#expect(groups.count == expected.count)
		for (g, e) in zip(groups, expected) {
			#expect(g.label == e["label"] as? String && g.showContact == e["showContact"] as? Bool)
			let points = e["points"] as! [[String: Any]]
			#expect(g.points.map(\.session.id) == points.map { $0["id"] as! String })
			for (p, q) in zip(g.points, points) {
				let best = q["best"] as! [String: Any]
				#expect(abs(p.best.flightMs - (best["flightMs"] as! Double)) < 1e-9)
				#expect(p.jumps.count == (q["jumps"] as! [Any]).count)
			}
		}
	}

	@Test func importsEveryWebExportVersion() throws {
		let v1 = try parseImport(Data(contentsOf: repoRoot.appendingPathComponent("src/lib/session/fixtures/export-v1.json")))
		#expect(!v1.isEmpty)
		#expect(v1.allSatisfy { $0.recordedAt == $0.media.lastModified && $0.jumpType == nil })
		#expect(throws: ImportError("Not an Airtime export file")) { try parseImport(Data("{}".utf8)) }
		#expect(throws: ImportError("Not a valid JSON file")) { try parseImport(Data("nope".utf8)) }
	}
}

@Suite struct Domain {
	@Test func placeMarkTogglesAndReplaces() {
		let t = Timing.rate(30)
		var marks = placeMark([], type: .landing, time: 10.5 / 30, timing: t)
		#expect(marks.count == 1 && abs(marks[0].time - 10.0 / 30) < 1e-12)
		marks = placeMark(marks, type: .takeoff, time: 10.2 / 30, timing: t)
		#expect(marks.count == 1 && marks[0].type == .takeoff)
		marks = placeMark(marks, type: .takeoff, time: 10.0 / 30, timing: t)
		#expect(marks.isEmpty)
	}

	@Test func defaultTitles() {
		#expect(defaultTitle("clip60.mp4") == "clip60")
		#expect(defaultTitle("a.b.mov") == "a.b")
		#expect(defaultTitle("noext") == "noext")
		#expect(defaultTitle(".mov") == "")
	}

	@Test func storeRoundTripsSessionsDraftsAndLocations() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("airtime-store-\(UUID().uuidString)")
		defer { try? FileManager.default.removeItem(at: dir) }
		let store = Store(root: dir)
		let fixture = try Data(contentsOf: repoRoot.appendingPathComponent("src/lib/session/fixtures/export-v3.json"))
		let first = try store.importBackup(fixture)
		#expect(first.imported > 0 && first.skipped == 0)
		let again = try store.importBackup(fixture)
		#expect(again.imported == 0 && again.skipped == first.imported)
		let sessions = store.readSessions().sessions
		#expect(sessions.count == first.imported)

		// The same video saved under another id (as the other app would) doesn't come in.
		var other = sessions[0]
		other.id = "another-id"
		other.updatedAt = "2099-01-01T00:00:00.000Z"
		#expect(oneSessionPerVideo([other], existing: sessions).isEmpty)
		var newer = other
		newer.id = "third-id"
		newer.media.fingerprint = "sha256:new-video"
		var older = newer
		older.id = "fourth-id"
		older.updatedAt = "2000-01-01T00:00:00.000Z"
		#expect(oneSessionPerVideo([older, newer], existing: sessions).map(\.id) == ["third-id"])
		var sameIdOlder = newer
		sameIdOlder.updatedAt = "2000-01-01T00:00:00.000Z"
		#expect(oneSessionPerVideo([newer, sameIdOlder], existing: sessions).map(\.updatedAt) == [newer.updatedAt])

		var session = sessions[0]
		session.notes = "felt good"
		store.setDraft(Draft(session: session, isNew: false, now: ISODate.now()), fingerprint: session.media.fingerprint)
		let draft = try #require(store.draft(fingerprint: session.media.fingerprint))
		#expect(pickRestore(saved: sessions[0], draft: draft).restore == .draft(draft, saved: sessions[0]))
		store.setDraft(nil, fingerprint: session.media.fingerprint)
		#expect(store.draft(fingerprint: session.media.fingerprint) == nil)

		// A video found in a video folder by fingerprint, then remembered.
		let videos = dir.appendingPathComponent("videos/nested")
		try FileManager.default.createDirectory(at: videos, withIntermediateDirectories: true)
		let clip = videos.appendingPathComponent("renamed.mp4")
		try FileManager.default.copyItem(at: repoRoot.appendingPathComponent("tests/frame-stepping/fixtures/cfr30.mp4"), to: clip)
		let print = try fingerprintFile(clip)
		let size = Double(try clip.resourceValues(forKeys: [.fileSizeKey]).fileSize!)
		#expect(store.locateVideo(fingerprint: print, sizeBytes: size) == nil)
		store.updateLibrary { $0.folders = [dir.appendingPathComponent("videos").path] }
		#expect(store.locateVideo(fingerprint: print, sizeBytes: size)?.lastPathComponent == "renamed.mp4")
		// Moved: the bookmark follows it without searching.
		store.updateLibrary { $0.folders = [] }
		let moved = dir.appendingPathComponent("moved.mp4")
		try FileManager.default.moveItem(at: clip, to: moved)
		#expect(store.locateVideo(fingerprint: print, sizeBytes: size)?.lastPathComponent == "moved.mp4")
	}
}
