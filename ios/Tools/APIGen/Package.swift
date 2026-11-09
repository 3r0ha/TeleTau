// swift-tools-version: 6.0
// Инструмент кодогенерации: swift-openapi-generator в виде CLI (ios/scripts/generate-api.sh).
// В приложение не входит — TeleTauCore зависит только от рантайма (swift-openapi-runtime, swift-openapi-urlsession).

import PackageDescription

let package = Package(
    name: "APIGen",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.3"),
    ],
    targets: []
)
