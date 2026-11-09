import TeleTauFeatures
import SwiftUI

@main
struct TeleTauApp: App {
    @State private var app = AppModel.live()

    var body: some Scene {
        WindowGroup {
            TeleTauRootView(app: app)
        }
    }
}
