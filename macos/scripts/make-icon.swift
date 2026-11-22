// Renders the app icon (src/lib/assets/app-icon.svg: the takeoff glyph on a dark tile) into an
// .iconset at every size macOS asks for. Usage: swift make-icon.swift <out.iconset>
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(_ pixels: Int) -> Data {
	let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
	let ctx = NSGraphicsContext.current!.cgContext
	let s = CGFloat(pixels) / 1024
	ctx.scaleBy(x: s, y: s)
	// macOS icon grid: an 824-point rounded tile centred in 1024.
	let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
	ctx.addPath(CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil))
	ctx.clip()
	let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [CGColor(gray: 0.11, alpha: 1), CGColor(gray: 0.04, alpha: 1)] as CFArray, locations: [0, 1])!
	ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 924), end: CGPoint(x: 0, y: 100), options: [])
	// The glyph's 16-unit grid, y down, as in the SVG.
	ctx.translateBy(x: 512 - 8 * 42, y: 512 + 8.5 * 42)
	ctx.scaleBy(x: 42, y: -42)
	ctx.setLineCap(.round)
	ctx.setLineJoin(.round)
	ctx.setStrokeColor(CGColor(gray: 0.24, alpha: 1))
	ctx.setLineWidth(1.1)
	ctx.move(to: CGPoint(x: 1.5, y: 14)); ctx.addLine(to: CGPoint(x: 14.5, y: 14)); ctx.strokePath()
	ctx.setStrokeColor(CGColor(gray: 0.95, alpha: 1))
	ctx.setLineWidth(1.8)
	ctx.move(to: CGPoint(x: 3.5, y: 11.5))
	ctx.addCurve(to: CGPoint(x: 13, y: 3), control1: CGPoint(x: 4.5, y: 6.5), control2: CGPoint(x: 8, y: 3.5))
	ctx.move(to: CGPoint(x: 10.2, y: 1.6)); ctx.addLine(to: CGPoint(x: 13, y: 3)); ctx.addLine(to: CGPoint(x: 11.3, y: 5.7))
	ctx.strokePath()
	NSGraphicsContext.restoreGraphicsState()
	return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
	try render(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
	try render(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
