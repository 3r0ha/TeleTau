import CoreImage
import Foundation
import SwiftUI
#if canImport(UIKit)
import AVFoundation
import UIKit
#endif

/// Распознавание QR на фото карточки (Core Image, без сторонних SDK).
enum QRDecoder {
    static func decode(imageData: Data) -> String? {
        guard let image = CIImage(data: imageData, options: [.applyOrientationProperty: true]) else { return nil }
        let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
        let features = detector?.features(in: image) ?? []
        return features.compactMap { ($0 as? CIQRCodeFeature)?.messageString }.first
    }
}

#if canImport(UIKit)
/// Камера для сканирования QR-карточки (AVFoundation): задняя камера, только QR, первый найденный код — наверх.
struct QRCameraView: UIViewRepresentable {
    let onCode: @MainActor (String) -> Void
    let onError: @MainActor (CameraFailure) -> Void

    enum CameraFailure: Sendable { case denied, notFound, unavailable }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        context.coordinator.start(in: view)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ view: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    /// AVCaptureSession потокобезопасна для startRunning/stopRunning (Apple рекомендует вызывать их вне главного
    /// потока), но не помечена Sendable.
    final class CaptureBox: @unchecked Sendable {
        let session = AVCaptureSession()
    }

    @MainActor
    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        var parent: QRCameraView
        private let box = CaptureBox()
        private var session: AVCaptureSession { box.session }
        private let queue = DispatchQueue(label: "ru.teletau.camera")
        private var delivered = false

        init(_ parent: QRCameraView) {
            self.parent = parent
        }

        func start(in view: PreviewView) {
            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                configure()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    Task { @MainActor in
                        if granted { self.configure() } else { self.parent.onError(.denied) }
                    }
                }
            default:
                parent.onError(.denied)
            }
        }

        private func configure() {
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(for: .video) else {
                parent.onError(.notFound)
                return
            }
            guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
                parent.onError(.unavailable)
                return
            }
            session.beginConfiguration()
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                session.commitConfiguration()
                parent.onError(.unavailable)
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            session.commitConfiguration()
            let box = self.box
            queue.async { box.session.startRunning() }
        }

        func stop() {
            let box = self.box
            queue.async { box.session.stopRunning() }
        }

        nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            let text = objects.compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }.first
            guard let text else { return }
            MainActor.assumeIsolated {
                guard !delivered else { return }
                delivered = true
                stop()
                parent.onCode(text)
            }
        }
    }
}
#endif
