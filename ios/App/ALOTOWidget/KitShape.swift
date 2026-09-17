//
//  KitShape.swift
//  ALOTOWidget
//
//  Draws a football kit from the same spec string the web app uses:
//
//      pattern:primary[:secondary[:sleeve[:shorts]]]
//
//      stripes:#e63946:#ffffff                    shirt and pattern
//      stripes:#e63946:#ffffff:#1a1a1a            + sleeves
//      stripes:#e63946:#ffffff:#1a1a1a:#1a1a1a    + shorts
//
//  Drawn rather than shipped as images so a kit looks identical on the lock
//  screen and in the app, and so adding a pattern needs no new assets. The
//  coordinates match the SVG in Shirt.jsx exactly, on the same 48-wide grid.
//
//  Sleeves and shorts are optional: a spec saved before they existed still
//  parses, with sleeves matching the shirt and no shorts.
//

import SwiftUI

struct Kit {
    let pattern: String
    let primary: Color
    let secondary: Color
    /// nil means "same as the shirt", which is what most kits are.
    let sleeve: Color?
    /// nil means no shorts — the shirt is drawn on its own.
    let shorts: Color?

    /// Returns nil for anything malformed, so a bad value shows initials
    /// rather than a broken shape.
    static func parse(_ spec: String?) -> Kit? {
        guard let spec, !spec.isEmpty else { return nil }
        let parts = spec.split(separator: ":").map(String.init)
        guard parts.count >= 2 else { return nil }

        let valid = ["plain", "stripes", "hoops", "halves", "sash", "quarters"]
        guard valid.contains(parts[0]) else { return nil }
        guard let primary = Color(hex: parts[1]) else { return nil }

        let secondary = parts.count > 2 ? (Color(hex: parts[2]) ?? .white) : .white

        // Both optional. An older three-part spec falls through with nil for
        // each, which draws exactly as it always did.
        let sleeve = parts.count > 3 ? Color(hex: parts[3]) : nil
        let shorts = parts.count > 4 ? Color(hex: parts[4]) : nil

        return Kit(pattern: parts[0], primary: primary, secondary: secondary,
                   sleeve: sleeve, shorts: shorts)
    }
}

extension Color {
    /// "#e63946" to a Color. Nil if it isn't six hex digits.
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red:   Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8)  & 0xFF) / 255,
            blue:  Double(v         & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// The shirt outline, on the same 48-wide grid as the web version so the two
/// shapes match.
///
/// Two hems, as in the web app: full length when the shirt is drawn alone, and
/// cut shorter when shorts sit beneath it. A full-length shirt over shorts
/// reads as a nightie and leaves the shorts a sliver at the bottom.
struct ShirtShape: Shape {
    var shortHem: Bool = false

    func path(in rect: CGRect) -> Path {
        // Scale from the WIDTH only. Using min(width, height) would shrink the
        // shirt whenever the frame is made taller to fit shorts.
        let s = rect.width / 48
        let hem: CGFloat = shortHem ? 36 : 44
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()
        path.move(to: p(22, 8))
        path.addLine(to: p(32, 4))
        path.addQuadCurve(to: p(40, 10), control: p(40, 10))
        path.addLine(to: p(46, 16))
        path.addLine(to: p(40, 24))
        path.addLine(to: p(36, 21))
        path.addLine(to: p(36, hem))
        path.addQuadCurve(to: p(24, hem + 2), control: p(32, hem + 2))
        path.addQuadCurve(to: p(12, hem), control: p(16, hem + 2))
        path.addLine(to: p(12, 21))
        path.addLine(to: p(8, 24))
        path.addLine(to: p(2, 16))
        path.addLine(to: p(8, 10))
        path.addQuadCurve(to: p(16, 4), control: p(8, 10))
        path.addLine(to: p(26, 8))
        path.closeSubpath()
        return path
    }
}

/// The two sleeve wings, drawn over the shirt and its pattern so a striped
/// shirt can still have plain sleeves.
struct SleevesShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 48
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()

        // Left.
        path.move(to: p(12, 21))
        path.addLine(to: p(8, 24))
        path.addLine(to: p(2, 16))
        path.addLine(to: p(8, 10))
        path.addQuadCurve(to: p(16, 4), control: p(8, 10))
        path.addLine(to: p(22, 8))
        path.addLine(to: p(12, 12))
        path.closeSubpath()

        // Right.
        path.move(to: p(36, 21))
        path.addLine(to: p(40, 24))
        path.addLine(to: p(46, 16))
        path.addLine(to: p(40, 10))
        path.addQuadCurve(to: p(32, 4), control: p(40, 10))
        path.addLine(to: p(26, 8))
        path.addLine(to: p(36, 12))
        path.closeSubpath()

        return path
    }
}

/// Shorts, with the notch between the legs. Drawn in its own frame beneath the
/// shirt rather than as part of it.
struct ShortsShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 48
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()
        path.move(to: p(12, 0))
        path.addLine(to: p(36, 0))
        path.addLine(to: p(37, 19))
        path.addLine(to: p(26, 19))
        path.addLine(to: p(24, 8))
        path.addLine(to: p(22, 19))
        path.addLine(to: p(11, 19))
        path.closeSubpath()
        return path
    }
}

/// A player's kit, or their initials where they haven't chosen one.
struct PlayerBadge: View {
    let kit: String?
    let name: String
    var size: CGFloat = 34

    var body: some View {
        if let k = Kit.parse(kit) {
            // Taller frame when shorts will be drawn, or the kit is squashed
            // into a square and the proportions go wrong. The ratio matches the
            // web app's viewBox: 64 tall against 48 wide.
            let withShorts = k.shorts != nil && size >= 26
            KitView(kit: k)
                .frame(width: size, height: withShorts ? size * 64 / 48 : size)
        } else {
            Text(Self.mark(from: name))
                .font(.system(size: size * 0.34, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: size, height: size)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: size * 0.28))
        }
    }

    /// Never a single letter — "J" identifies nobody in a two-player tie.
    /// Matches playerMark() in the web app exactly, so the same person shows
    /// the same mark in both places.
    static func mark(from name: String) -> String {
        let words = name.split(separator: " ").map(String.init).filter { !$0.isEmpty }
        guard !words.isEmpty else { return "?" }
        if words.count == 1 { return String(words[0].prefix(3)).uppercased() }
        return words.prefix(3).compactMap { $0.first }.map(String.init).joined().uppercased()
    }
}

struct KitView: View {
    let kit: Kit

    /// Below this, shorts are left off.
    ///
    /// Matches the web app. At Dynamic Island sizes the shorts are two or three
    /// pixels tall, and including them means shrinking the shirt to make room —
    /// so the compact states would get a smaller shirt AND an unreadable smudge
    /// beneath it.
    private static let shortsMinSize: CGFloat = 26

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let s = w / 48
            let withShorts = kit.shorts != nil && w >= Self.shortsMinSize

            VStack(spacing: 0) {
                ZStack {
                    ShirtShape(shortHem: withShorts).fill(kit.primary)

                    // The pattern, clipped to the shirt so nothing bleeds past
                    // the edge.
                    patternLayer(scale: s)
                        .clipShape(ShirtShape(shortHem: withShorts))

                    // Sleeves over the pattern — a striped shirt with plain
                    // sleeves is a common kit and the stripes must not run
                    // through them.
                    if let sleeve = kit.sleeve, sleeve != kit.primary {
                        SleevesShape().fill(sleeve)
                    }

                    // Outline last, over everything.
                    ShirtShape(shortHem: withShorts)
                        .stroke(Color.black.opacity(0.35), lineWidth: 1.5 * s)
                }
                .frame(height: (withShorts ? 40 : 48) * s)

                if withShorts, let shorts = kit.shorts {
                    ZStack {
                        ShortsShape().fill(shorts)
                        ShortsShape().stroke(Color.black.opacity(0.35), lineWidth: 1.5 * s)
                    }
                    .frame(height: 20 * s)
                }
            }
        }
    }

    @ViewBuilder
    private func patternLayer(scale s: CGFloat) -> some View {
        switch kit.pattern {
        case "stripes":
            ForEach(0..<4, id: \.self) { i in
                Rectangle().fill(kit.secondary)
                    .frame(width: 5 * s, height: 48 * s)
                    .offset(x: (8 + CGFloat(i) * 9) * s - 24 * s + 2.5 * s)
            }
        case "hoops":
            ForEach(0..<3, id: \.self) { i in
                Rectangle().fill(kit.secondary)
                    .frame(width: 48 * s, height: 5 * s)
                    .offset(y: (16 + CGFloat(i) * 10) * s - 24 * s + 2.5 * s)
            }
        case "halves":
            Rectangle().fill(kit.secondary)
                .frame(width: 24 * s, height: 48 * s)
                .offset(x: 12 * s)
        case "quarters":
            ZStack {
                Rectangle().fill(kit.secondary)
                    .frame(width: 24 * s, height: 24 * s)
                    .offset(x: 12 * s, y: -12 * s)
                Rectangle().fill(kit.secondary)
                    .frame(width: 24 * s, height: 24 * s)
                    .offset(x: -12 * s, y: 12 * s)
            }
        case "sash":
            Rectangle().fill(kit.secondary)
                .frame(width: 70 * s, height: 10 * s)
                .rotationEffect(.degrees(-35))
        default:
            EmptyView()   // plain — the base colour is the whole shirt
        }
    }
}
