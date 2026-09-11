//
//  KitShape.swift
//  ALOTOWidget
//
//  Draws a football shirt from the same spec string the web app uses —
//  "stripes:#e63946:#ffffff".
//
//  Drawn rather than shipped as images so a kit looks identical on the lock
//  screen and in the app, and so adding a pattern needs no new assets. The
//  coordinates match the SVG in Shirt.jsx exactly, on the same 48x48 grid.
//

import SwiftUI

struct Kit {
    let pattern: String
    let primary: Color
    let secondary: Color

    /// Parses "stripes:#e63946:#ffffff". Returns nil for anything malformed,
    /// so a bad value shows initials rather than a broken shape.
    static func parse(_ spec: String?) -> Kit? {
        guard let spec, !spec.isEmpty else { return nil }
        let parts = spec.split(separator: ":").map(String.init)
        guard parts.count >= 2 else { return nil }

        let valid = ["plain", "stripes", "hoops", "halves", "sash", "quarters"]
        guard valid.contains(parts[0]) else { return nil }
        guard let primary = Color(hex: parts[1]) else { return nil }

        let secondary = parts.count > 2 ? (Color(hex: parts[2]) ?? .white) : .white
        return Kit(pattern: parts[0], primary: primary, secondary: secondary)
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

/// The shirt outline, on the same 48x48 grid as the web version so the two
/// shapes match.
struct ShirtShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 48
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
        path.addLine(to: p(36, 44))
        path.addQuadCurve(to: p(24, 46), control: p(32, 46))
        path.addQuadCurve(to: p(12, 44), control: p(16, 46))
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

/// A player's kit, or their initials where they haven't chosen one.
struct PlayerBadge: View {
    let kit: String?
    let name: String
    var size: CGFloat = 34

    var body: some View {
        if let k = Kit.parse(kit) {
            KitView(kit: k).frame(width: size, height: size)
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

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height) / 48

            ZStack {
                ShirtShape().fill(kit.primary)

                // The pattern, clipped to the shirt so nothing bleeds past
                // the edge.
                patternLayer(scale: s)
                    .clipShape(ShirtShape())

                // Outline last, over the pattern.
                ShirtShape().stroke(Color.black.opacity(0.35), lineWidth: 1.5 * s)
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
