# Enigma — Setup Guide

## Prerequisites

- Node.js 18+
- JDK 17 (`winget install EclipseAdoptium.Temurin.17.JDK`)
- Android Studio with Android SDK (API 31+)
- A physical Android device (Bluetooth doesn't work in emulator)

---

## 1. Initialise the React Native project

Run this **once** from the parent folder (`Projects/`), not inside `Enigma/`:

```bash
npx react-native@0.73.6 init Enigma --skip-install
```

This generates the `android/` and `ios/` native directories.
Then copy (overwrite) all the files from this repo into the new folder.

---

## 2. Install dependencies

```bash
cd Enigma
npm install
```

---

## 3. Add Bluetooth permissions to Android

Open `android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`:

```xml
<!-- Classic Bluetooth (≤ API 30) -->
<uses-permission android:name="android.permission.BLUETOOTH"
    android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN"
    android:maxSdkVersion="30" />

<!-- Bluetooth (API 31+, Android 12+) -->
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />

<!-- Location needed for discovery on API ≤ 30 -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

---

## 4. Run on device

```bash
npx react-native run-android
```

---

## How it works

### .enigma file format

A `.enigma` file is a single-line JSON string, e.g.:

```json
{"version":"1","id":"abc123","threadId":"xyz","from":"Alice","to":"Enigma","timestamp":"2024-01-15T10:30:00.000Z","body":"Hey, are you coming tonight?"}
```

Over Bluetooth (RFCOMM), messages are framed with a trailing `\n`.
As a file on disk or in email, the raw JSON content is the file.

### Relay flow

```
Anyone → .enigma file → relay node (laptop / online phone)
                             │  Bluetooth RFCOMM
                             ▼
                        Enigma device  ←→  reads, replies
                             │  Bluetooth RFCOMM
                             ▼
                        relay node → forward .enigma file anywhere
```

### Bluetooth pairing

1. Pair the Enigma device with the relay device via Android Bluetooth settings (one-time).
2. Open the app → tap the dot in the top-right → Settings → select the paired device → Connect.
3. The green dot confirms the connection.

### Multiple senders

Each `.enigma` file includes a `threadId` and `from` field.
Conversations are grouped by thread and sorted by last message time.
The relay can forward files from any source — each new `from` name creates
a separate conversation automatically.

---

## Laptop relay (Node.js)

See `relay/` for a minimal Node.js script that watches a folder for `.enigma`
files and forwards them over Bluetooth RFCOMM using `bluetooth-serial-port`.
