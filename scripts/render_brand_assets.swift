#!/usr/bin/env swift

import AppKit
import Foundation

func hexColor(_ hex: String, alpha: CGFloat = 1.0) -> NSColor {
  let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
  var value: UInt64 = 0
  Scanner(string: cleaned).scanHexInt64(&value)

  return NSColor(
    red: CGFloat((value >> 16) & 0xFF) / 255.0,
    green: CGFloat((value >> 8) & 0xFF) / 255.0,
    blue: CGFloat(value & 0xFF) / 255.0,
    alpha: alpha
  )
}

func makeCanvas(size: NSSize) -> (NSImage, NSBitmapImageRep) {
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(size.width),
    pixelsHigh: Int(size.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bitmapFormat: [],
    bytesPerRow: 0,
    bitsPerPixel: 0
  )!

  rep.size = size

  let image = NSImage(size: size)
  image.addRepresentation(rep)
  return (image, rep)
}

func savePNG(_ image: NSImage, to path: String) throws {
  var rect = NSRect(origin: .zero, size: image.size)

  guard
    let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
    let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:])
  else {
    throw NSError(domain: "brand-assets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode PNG"])
  }

  try png.write(to: URL(fileURLWithPath: path))
}

func roundedRect(_ rect: CGRect, radius: CGFloat) -> NSBezierPath {
  NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
}

func fillBackground(_ rect: CGRect) {
  let gradient = NSGradient(colors: [
    hexColor("06121E"),
    hexColor("0A1A2E"),
    hexColor("040A14"),
  ])!

  gradient.draw(in: roundedRect(rect, radius: 36), angle: -32)

  NSGraphicsContext.saveGraphicsState()
  roundedRect(rect, radius: 36).addClip()

  NSGradient(colorsAndLocations:
    (hexColor("62F1FF", alpha: 0.30), 0.0),
    (hexColor("62F1FF", alpha: 0.0), 1.0)
  )!.draw(in: CGRect(x: 730, y: 360, width: 420, height: 300), relativeCenterPosition: NSPoint(x: 0.15, y: -0.15))

  NSGradient(colorsAndLocations:
    (hexColor("FF9A71", alpha: 0.24), 0.0),
    (hexColor("FF9A71", alpha: 0.0), 1.0)
  )!.draw(in: CGRect(x: 830, y: 40, width: 320, height: 220), relativeCenterPosition: NSPoint(x: 0.0, y: 0.0))

  NSGradient(colorsAndLocations:
    (hexColor("497AFF", alpha: 0.18), 0.0),
    (hexColor("497AFF", alpha: 0.0), 1.0)
  )!.draw(in: CGRect(x: 80, y: 30, width: 380, height: 220), relativeCenterPosition: NSPoint(x: 0.0, y: 0.0))

  hexColor("8DF5FF", alpha: 0.10).setStroke()
  for y in stride(from: 430 as CGFloat, through: 110, by: -54) {
    let line = NSBezierPath()
    line.move(to: CGPoint(x: 732, y: y))
    line.line(to: CGPoint(x: 1122, y: y))
    line.lineWidth = 2
    line.stroke()
  }

  for (start, end, color) in [
    (CGPoint(x: 782, y: 600), CGPoint(x: 1036, y: 70), hexColor("5682FF", alpha: 0.12)),
    (CGPoint(x: 848, y: 626), CGPoint(x: 1096, y: 98), hexColor("FF9E72", alpha: 0.10)),
  ] {
    color.setStroke()
    let line = NSBezierPath()
    line.move(to: start)
    line.line(to: end)
    line.lineWidth = 2
    line.stroke()
  }

  NSGraphicsContext.restoreGraphicsState()
}

func drawSpark(at center: CGPoint, outer: CGFloat, inner: CGFloat, color: NSColor) {
  let path = NSBezierPath()
  let points = 8

  for index in 0..<points {
    let angle = (CGFloat(index) * .pi / 4.0) - (.pi / 2.0)
    let radius = index.isMultiple(of: 2) ? outer : inner
    let point = CGPoint(
      x: center.x + cos(angle) * radius,
      y: center.y + sin(angle) * radius
    )

    if index == 0 {
      path.move(to: point)
    } else {
      path.line(to: point)
    }
  }

  path.close()
  color.setFill()
  path.fill()
}

func drawBlade(in rect: CGRect, angle: CGFloat, colors: [NSColor]) {
  let path = roundedRect(rect, radius: rect.width / 2)
  let gradient = NSGradient(colors: colors)!

  var transform = AffineTransform()
  transform.translate(x: rect.midX, y: rect.midY)
  transform.rotate(byDegrees: angle)
  transform.translate(x: -rect.midX, y: -rect.midY)
  path.transform(using: transform)
  gradient.draw(in: path, angle: 90)
}

func rotatedPath(for rect: CGRect, radius: CGFloat, angle: CGFloat) -> NSBezierPath {
  let path = roundedRect(rect, radius: radius)
  var transform = AffineTransform()
  transform.translate(x: rect.midX, y: rect.midY)
  transform.rotate(byDegrees: angle)
  transform.translate(x: -rect.midX, y: -rect.midY)
  path.transform(using: transform)
  return path
}

func drawIcon(in rect: CGRect, compact: Bool = false) {
  let shadow = NSShadow()
  shadow.shadowBlurRadius = rect.width * 0.06
  shadow.shadowOffset = NSSize(width: 0, height: -rect.width * 0.03)
  shadow.shadowColor = hexColor("05111A", alpha: 0.42)

  NSGraphicsContext.saveGraphicsState()
  shadow.set()

  let outer = roundedRect(rect, radius: rect.width * 0.28)
  NSGradient(colors: [hexColor("7AF6FF"), hexColor("6188FF"), hexColor("FF9E72")])!.draw(in: outer, angle: -32)
  NSGraphicsContext.restoreGraphicsState()

  let inset = max(6, rect.width * 0.018)
  let innerRect = rect.insetBy(dx: inset, dy: inset)
  let inner = roundedRect(innerRect, radius: innerRect.width * 0.275)

  NSGradient(colors: [hexColor("07131F"), hexColor("0B1F35"), hexColor("040B15")])!.draw(in: inner, angle: -36)

  NSGraphicsContext.saveGraphicsState()
  inner.addClip()

  NSGradient(colorsAndLocations:
    (hexColor("70F3FF", alpha: 0.28), 0.0),
    (hexColor("70F3FF", alpha: 0.0), 1.0)
  )!.draw(
    in: innerRect.insetBy(dx: -innerRect.width * 0.18, dy: -innerRect.height * 0.16),
    relativeCenterPosition: NSPoint(x: -0.36, y: 0.38)
  )

  NSGradient(colorsAndLocations:
    (hexColor("FFA16C", alpha: 0.22), 0.0),
    (hexColor("FFA16C", alpha: 0.0), 1.0)
  )!.draw(
    in: innerRect.insetBy(dx: -innerRect.width * 0.08, dy: -innerRect.height * 0.08),
    relativeCenterPosition: NSPoint(x: 0.42, y: -0.42)
  )

  let topLine = NSBezierPath()
  topLine.move(to: CGPoint(x: innerRect.minX + innerRect.width * 0.17, y: innerRect.maxY - innerRect.height * 0.22))
  topLine.line(to: CGPoint(x: innerRect.maxX - innerRect.width * 0.17, y: innerRect.maxY - innerRect.height * 0.22))
  topLine.lineWidth = max(2, rect.width * 0.01)
  hexColor("87F7FF", alpha: compact ? 0.10 : 0.14).setStroke()
  topLine.lineCapStyle = .round
  topLine.stroke()

  let bottomLine = NSBezierPath()
  bottomLine.move(to: CGPoint(x: innerRect.minX + innerRect.width * 0.17, y: innerRect.minY + innerRect.height * 0.23))
  bottomLine.line(to: CGPoint(x: innerRect.maxX - innerRect.width * 0.17, y: innerRect.minY + innerRect.height * 0.23))
  bottomLine.lineWidth = max(2, rect.width * 0.01)
  hexColor("FFB08A", alpha: compact ? 0.10 : 0.14).setStroke()
  bottomLine.lineCapStyle = .round
  bottomLine.stroke()

  let diagA = NSBezierPath()
  diagA.move(to: CGPoint(x: innerRect.minX + innerRect.width * 0.22, y: innerRect.maxY - innerRect.height * 0.12))
  diagA.line(to: CGPoint(x: innerRect.maxX - innerRect.width * 0.24, y: innerRect.minY + innerRect.height * 0.14))
  diagA.lineWidth = max(1.5, rect.width * 0.008)
  hexColor("5C86FF", alpha: compact ? 0.08 : 0.12).setStroke()
  diagA.lineCapStyle = .round
  diagA.stroke()

  let diagB = NSBezierPath()
  diagB.move(to: CGPoint(x: innerRect.maxX - innerRect.width * 0.12, y: innerRect.maxY - innerRect.height * 0.18))
  diagB.line(to: CGPoint(x: innerRect.minX + innerRect.width * 0.26, y: innerRect.minY + innerRect.height * 0.14))
  diagB.lineWidth = max(1.5, rect.width * 0.008)
  hexColor("7DF6FF", alpha: compact ? 0.08 : 0.12).setStroke()
  diagB.lineCapStyle = .round
  diagB.stroke()

  NSGraphicsContext.restoreGraphicsState()

  let backPanelRect = CGRect(
    x: rect.midX - rect.width * 0.19,
    y: rect.midY - rect.width * 0.13,
    width: rect.width * 0.34,
    height: rect.width * 0.44
  )
  let backPanel = rotatedPath(for: backPanelRect, radius: rect.width * 0.055, angle: -16)
  hexColor("4D87FF", alpha: compact ? 0.18 : 0.22).setFill()
  backPanel.fill()
  hexColor("79DFFF", alpha: compact ? 0.18 : 0.24).setStroke()
  backPanel.lineWidth = max(1.5, rect.width * 0.004)
  backPanel.stroke()

  let midPanelRect = CGRect(
    x: rect.midX - rect.width * 0.12,
    y: rect.midY - rect.width * 0.16,
    width: rect.width * 0.34,
    height: rect.width * 0.44
  )
  let midPanel = rotatedPath(for: midPanelRect, radius: rect.width * 0.055, angle: 12)
  hexColor("FF9E72", alpha: compact ? 0.18 : 0.2).setFill()
  midPanel.fill()
  hexColor("FFE0C6", alpha: compact ? 0.12 : 0.16).setStroke()
  midPanel.lineWidth = max(1.5, rect.width * 0.004)
  midPanel.stroke()

  let frontPanelRect = CGRect(
    x: rect.midX - rect.width * 0.16,
    y: rect.midY - rect.width * 0.20,
    width: rect.width * 0.36,
    height: rect.width * 0.48
  )
  let frontOuter = roundedRect(frontPanelRect, radius: rect.width * 0.065)
  NSGradient(colors: [hexColor("7AF6FF"), hexColor("6188FF"), hexColor("FF9E72")])!.draw(in: frontOuter, angle: -34)

  let frontInnerRect = frontPanelRect.insetBy(dx: max(4, rect.width * 0.012), dy: max(4, rect.width * 0.012))
  let frontInner = roundedRect(frontInnerRect, radius: rect.width * 0.055)
  NSGradient(colors: [hexColor("07111D"), hexColor("0A1B2C"), hexColor("06111A")])!.draw(in: frontInner, angle: -20)

  let glowPath = roundedRect(frontInnerRect.insetBy(dx: rect.width * 0.02, dy: rect.width * 0.02), radius: rect.width * 0.04)
  hexColor("7BF5FF", alpha: compact ? 0.06 : 0.08).setFill()
  glowPath.fill()

  let cropInsetX = frontInnerRect.width * 0.18
  let cropInsetY = frontInnerRect.height * 0.16
  let cropLength = frontInnerRect.width * 0.12
  let cropLineWidth = max(3, rect.width * 0.01)

  func strokeCrop(_ points: [CGPoint], color: NSColor) {
    let path = NSBezierPath()
    path.move(to: points[0])
    for point in points.dropFirst() {
      path.line(to: point)
    }
    path.lineWidth = cropLineWidth
    path.lineCapStyle = .round
    color.setStroke()
    path.stroke()
  }

  strokeCrop([
    CGPoint(x: frontInnerRect.minX + cropInsetX, y: frontInnerRect.maxY - cropInsetY - cropLength),
    CGPoint(x: frontInnerRect.minX + cropInsetX, y: frontInnerRect.maxY - cropInsetY),
    CGPoint(x: frontInnerRect.minX + cropInsetX + cropLength, y: frontInnerRect.maxY - cropInsetY),
  ], color: hexColor("7AF6FF"))

  strokeCrop([
    CGPoint(x: frontInnerRect.maxX - cropInsetX - cropLength, y: frontInnerRect.maxY - cropInsetY),
    CGPoint(x: frontInnerRect.maxX - cropInsetX, y: frontInnerRect.maxY - cropInsetY),
    CGPoint(x: frontInnerRect.maxX - cropInsetX, y: frontInnerRect.maxY - cropInsetY - cropLength),
  ], color: hexColor("9AB6FF"))

  strokeCrop([
    CGPoint(x: frontInnerRect.minX + cropInsetX, y: frontInnerRect.minY + cropInsetY + cropLength),
    CGPoint(x: frontInnerRect.minX + cropInsetX, y: frontInnerRect.minY + cropInsetY),
    CGPoint(x: frontInnerRect.minX + cropInsetX + cropLength, y: frontInnerRect.minY + cropInsetY),
  ], color: hexColor("74DFFF"))

  strokeCrop([
    CGPoint(x: frontInnerRect.maxX - cropInsetX - cropLength, y: frontInnerRect.minY + cropInsetY),
    CGPoint(x: frontInnerRect.maxX - cropInsetX, y: frontInnerRect.minY + cropInsetY),
    CGPoint(x: frontInnerRect.maxX - cropInsetX, y: frontInnerRect.minY + cropInsetY + cropLength),
  ], color: hexColor("FFB27D"))

  let bottomBar = roundedRect(
    CGRect(
      x: frontInnerRect.minX + frontInnerRect.width * 0.2,
      y: frontInnerRect.minY + frontInnerRect.height * 0.14,
      width: frontInnerRect.width * 0.6,
      height: rect.width * 0.035
    ),
    radius: rect.width * 0.018
  )
  NSGradient(colors: [hexColor("70F3FF"), hexColor("6188FF"), hexColor("FF9E72")])!.draw(in: bottomBar, angle: 0)

  let centerGlow = NSBezierPath(ovalIn: CGRect(
    x: rect.midX - rect.width * 0.09,
    y: rect.midY - rect.width * 0.09,
    width: rect.width * 0.18,
    height: rect.width * 0.18
  ))
  NSGradient(colorsAndLocations:
    (hexColor("FCFEFF", alpha: 0.84), 0.0),
    (hexColor("BFE8FF", alpha: 0.26), 0.66),
    (hexColor("BFE8FF", alpha: 0.0), 1.0)
  )!.draw(in: centerGlow, relativeCenterPosition: NSPoint(x: 0, y: 0))

  drawSpark(at: CGPoint(x: rect.midX, y: rect.midY + rect.width * 0.01), outer: rect.width * 0.075, inner: rect.width * 0.03, color: .white)
  drawSpark(at: CGPoint(x: rect.midX, y: rect.midY + rect.width * 0.01), outer: rect.width * 0.05, inner: rect.width * 0.02, color: hexColor("7EF5FF"))

  let coreDot = NSBezierPath(ovalIn: CGRect(
    x: rect.midX - rect.width * 0.018,
    y: rect.midY - rect.width * 0.008,
    width: rect.width * 0.036,
    height: rect.width * 0.036
  ))
  hexColor("081624").setFill()
  coreDot.fill()

  for (dotRect, color) in [
    (
      CGRect(
        x: frontInnerRect.maxX - frontInnerRect.width * 0.22,
        y: frontInnerRect.minY + frontInnerRect.height * 0.26,
        width: rect.width * 0.028,
        height: rect.width * 0.028
      ),
      hexColor("7AF4FF", alpha: 0.9)
    ),
    (
      CGRect(
        x: frontInnerRect.maxX - frontInnerRect.width * 0.16,
        y: frontInnerRect.minY + frontInnerRect.height * 0.19,
        width: rect.width * 0.02,
        height: rect.width * 0.02
      ),
      hexColor("FFB27D", alpha: 0.9)
    ),
  ] {
    let dot = NSBezierPath(roundedRect: dotRect, xRadius: rect.width * 0.008, yRadius: rect.width * 0.008)
    color.setFill()
    dot.fill()
  }

  drawSpark(
    at: CGPoint(x: rect.midX + rect.width * 0.24, y: rect.midY + rect.width * 0.21),
    outer: rect.width * 0.03,
    inner: rect.width * 0.012,
    color: .white
  )
}

func paragraphStyle(_ alignment: NSTextAlignment = .left) -> NSParagraphStyle {
  let style = NSMutableParagraphStyle()
  style.alignment = alignment
  return style
}

func drawText(_ text: String, rect: CGRect, size: CGFloat, weight: NSFont.Weight, color: NSColor, tracking: CGFloat = 0.0) {
  let font = NSFont.systemFont(ofSize: size, weight: weight)
  let attributes: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: color,
    .paragraphStyle: paragraphStyle(),
    .kern: tracking,
  ]
  NSString(string: text).draw(in: rect, withAttributes: attributes)
}

func drawBadge(text: String, rect: CGRect, stroke: NSColor, foreground: NSColor) {
  let pill = roundedRect(rect, radius: rect.height / 2)
  hexColor("0C1D32", alpha: 0.90).setFill()
  pill.fill()
  stroke.setStroke()
  pill.lineWidth = 1.5
  pill.stroke()

  drawText(
    text,
    rect: rect.insetBy(dx: 16, dy: 9),
    size: 18,
    weight: .bold,
    color: foreground
  )
}

func renderLogo(to path: String, size: CGFloat) throws {
  let canvas = NSSize(width: size, height: size)
  let (image, rep) = makeCanvas(size: canvas)
  let context = NSGraphicsContext(bitmapImageRep: rep)!

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  NSColor.clear.setFill()
  NSRect(origin: .zero, size: canvas).fill()

  drawIcon(
    in: CGRect(
      x: size * 0.13,
      y: size * 0.13,
      width: size * 0.74,
      height: size * 0.74
    ),
    compact: size <= 256
  )

  NSGraphicsContext.restoreGraphicsState()
  try savePNG(image, to: path)
}

func renderPreview(to path: String) throws {
  let size = NSSize(width: 1200, height: 630)
  let (image, rep) = makeCanvas(size: size)
  let context = NSGraphicsContext(bitmapImageRep: rep)!

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context

  fillBackground(CGRect(origin: .zero, size: size))

  let pillRect = CGRect(x: 72, y: 532, width: 420, height: 38)
  let pill = roundedRect(pillRect, radius: 19)
  hexColor("0C1D30", alpha: 0.88).setFill()
  pill.fill()
  NSGradient(colors: [hexColor("74F4FF"), hexColor("FF9E73")])!.draw(in: pill, angle: 0)
  let pillInner = roundedRect(pillRect.insetBy(dx: 1.5, dy: 1.5), radius: 17.5)
  hexColor("0C1D30", alpha: 0.96).setFill()
  pillInner.fill()
  drawText("PROFESSIONAL AI IMAGE STUDIO", rect: CGRect(x: 96, y: 540, width: 372, height: 20), size: 15, weight: .bold, color: hexColor("E3FCFF"), tracking: 1.4)

  drawText("ChatGPT", rect: CGRect(x: 72, y: 406, width: 400, height: 82), size: 80, weight: .bold, color: .white)

  drawText("Image 2", rect: CGRect(x: 72, y: 320, width: 420, height: 86), size: 82, weight: .bold, color: hexColor("8FD7FF"))

  drawText("Generate, edit and remix images with cleaner outputs,", rect: CGRect(x: 72, y: 246, width: 600, height: 34), size: 28, weight: .regular, color: hexColor("D5E3F0"))
  drawText("tighter prompt control and a more production-ready workflow.", rect: CGRect(x: 72, y: 208, width: 660, height: 34), size: 28, weight: .regular, color: hexColor("D5E3F0"))

  drawBadge(text: "Text to Image", rect: CGRect(x: 72, y: 114, width: 170, height: 48), stroke: hexColor("2B6E94"), foreground: hexColor("E6FCFF"))
  drawBadge(text: "Precise Edit", rect: CGRect(x: 254, y: 114, width: 146, height: 48), stroke: hexColor("3D6FFF"), foreground: hexColor("EAF2FF"))
  drawBadge(text: "Reference Remix", rect: CGRect(x: 412, y: 114, width: 186, height: 48), stroke: hexColor("FF9567"), foreground: hexColor("FFF2EC"))

  drawText("image3.org", rect: CGRect(x: 72, y: 56, width: 220, height: 24), size: 18, weight: .bold, color: hexColor("8AA7C3"), tracking: 2.6)

  drawIcon(in: CGRect(x: 748, y: 228, width: 316, height: 316))

  let cardRect = CGRect(x: 780, y: 90, width: 286, height: 108)
  let card = roundedRect(cardRect, radius: 28)
  hexColor("0C1D32", alpha: 0.88).setFill()
  card.fill()
  hexColor("214966").setStroke()
  card.lineWidth = 1.5
  card.stroke()

  for (rect, color) in [
    (CGRect(x: 810, y: 164, width: 104, height: 10), hexColor("7AF4FF")),
    (CGRect(x: 810, y: 140, width: 182, height: 10), hexColor("D9E6F2", alpha: 0.78)),
    (CGRect(x: 810, y: 116, width: 154, height: 10), hexColor("D9E6F2", alpha: 0.42)),
  ] {
    let line = roundedRect(rect, radius: 5)
    color.setFill()
    line.fill()
  }

  let miniButton = roundedRect(CGRect(x: 996, y: 148, width: 40, height: 40), radius: 14)
  hexColor("10243A").setFill()
  miniButton.fill()
  hexColor("2F5E84").setStroke()
  miniButton.lineWidth = 1.2
  miniButton.stroke()

  let lineA = NSBezierPath()
  lineA.move(to: CGPoint(x: 1008, y: 160))
  lineA.line(to: CGPoint(x: 1008, y: 178))
  lineA.lineWidth = 4.5
  lineA.lineCapStyle = .round
  hexColor("7AF4FF").setStroke()
  lineA.stroke()

  let lineB = NSBezierPath()
  lineB.move(to: CGPoint(x: 1020, y: 156))
  lineB.line(to: CGPoint(x: 1020, y: 182))
  lineB.lineWidth = 4.5
  lineB.lineCapStyle = .round
  hexColor("7AA8FF").setStroke()
  lineB.stroke()

  NSGraphicsContext.restoreGraphicsState()
  try savePNG(image, to: path)
}

let root = FileManager.default.currentDirectoryPath

try renderLogo(to: "\(root)/public/logo.png", size: 512)
try renderLogo(to: "\(root)/public/apple-touch-icon.png", size: 180)
try renderLogo(to: "\(root)/public/favicon.png", size: 256)
try renderPreview(to: "\(root)/public/preview.png")
