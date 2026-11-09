// swift-tools-version: 6.0
// TeleTauCore — общие модули iOS-клиента «ТелеТау».
// Swift 6 language mode: строгая проверка конкурентности включена для всех таргетов.
//
// Сторонних SDK нет (CLAUDE.md, правило 12): из внешних пакетов — только рантайм swift-openapi-generator
// от Apple (Apache 2.0): им пользуется сгенерированный клиент TeleTauAPI.

import PackageDescription

let package = Package(
    name: "TeleTauCore",
    defaultLocalization: "ru",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "BashkirText", targets: ["BashkirText"]),
        .library(name: "AuthCodes", targets: ["AuthCodes"]),
        .library(name: "TeleTauAPI", targets: ["TeleTauAPI"]),
        .library(name: "TeleTauSession", targets: ["TeleTauSession"]),
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
        .library(name: "TeleTauFeatures", targets: ["TeleTauFeatures"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.0.0"),
    ],
    targets: [
        // Порт packages/bashkir-text (TS). Таблицы — BashkirTable.generated.swift.
        .target(name: "BashkirText"),
        // Порт packages/auth-codes: разбор QR-карточки и кода класса (ADR 0016).
        .target(name: "AuthCodes"),
        // Клиент API, сгенерированный swift-openapi-generator из packages/contracts/openapi.yaml
        // (ios/scripts/generate-api.sh). Руками в этом таргете ничего не пишется.
        .target(
            name: "TeleTauAPI",
            dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")]
        ),
        // Сессия (Keychain, single-flight refresh), транспорт, Problem Details, фасад операций.
        .target(
            name: "TeleTauSession",
            dependencies: [
                "TeleTauAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
        // Токены «Борть» (TeleTauTokens.generated.swift), шрифты, иконки Phosphor, иллюстрации, компоненты.
        .target(
            name: "DesignSystem",
            resources: [
                // PNG папкой, не Asset Catalog: без рантайма симулятора actool не собирает каталоги под iphonesimulator
                // (ios/scripts/import-illustrations.sh). Читает IllustrationStore.
                .copy("Resources/Illustrations"),
                .copy("Resources/Fonts"),
            ]
        ),
        // Экраны ученика: вход, тропа, урок, лига, класс, профиль.
        .target(
            name: "TeleTauFeatures",
            dependencies: ["DesignSystem", "TeleTauSession", "TeleTauAPI", "AuthCodes", "BashkirText"]
        ),
        // Общие векторы: contracts/test-vectors/bashkir-text/*.json.
        .testTarget(
            name: "BashkirTextTests",
            dependencies: ["BashkirText"]
        ),
        // Общие векторы: contracts/test-vectors/{qr-card,class-code}/*.json.
        .testTarget(
            name: "AuthCodesTests",
            dependencies: ["AuthCodes"]
        ),
        // Сессия: single-flight refresh, хранение токенов, Problem Details, повтор после 401.
        .testTarget(
            name: "TeleTauSessionTests",
            dependencies: [
                "TeleTauSession",
                "TeleTauAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
        // Рендер стартового экрана в PNG (ImageRenderer, macOS) в обеих темах; шрифты и locl BSH.
        .testTarget(
            name: "DesignSystemTests",
            dependencies: ["DesignSystem"],
            exclude: ["__Snapshots__"]
        ),
        // Рендер экранов ученика в эталонные снимки; автомат урока.
        .testTarget(
            name: "TeleTauFeaturesTests",
            dependencies: [
                "TeleTauFeatures", "DesignSystem", "TeleTauAPI", "TeleTauSession", "AuthCodes",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
