// swift-tools-version: 6.0
import PackageDescription

let package = Package(
	name: "Airtime",
	platforms: [.macOS(.v15)],
	products: [
		.executable(name: "Airtime", targets: ["Airtime"]),
		.executable(name: "frame-check", targets: ["frame-check"])
	],
	targets: [
		// Frame math, marks, sessions, export and trends: no UI, no AVFoundation.
		.target(name: "AirtimeKit"),
		// Opening, stepping and scrubbing video with AVFoundation.
		.target(name: "AirtimePlayer", dependencies: ["AirtimeKit"]),
		.executableTarget(name: "Airtime", dependencies: ["AirtimeKit", "AirtimePlayer"]),
		// Decoded-frame oracle: steps the player through the barcode fixtures in
		// tests/frame-stepping and reads back every picture.
		.executableTarget(name: "frame-check", dependencies: ["AirtimeKit", "AirtimePlayer"]),
		.testTarget(name: "AirtimeKitTests", dependencies: ["AirtimeKit"])
	],
	swiftLanguageModes: [.v5]
)
