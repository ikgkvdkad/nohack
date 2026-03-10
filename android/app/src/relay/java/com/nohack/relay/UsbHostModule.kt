package com.nohack.relay

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.*
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

/**
 * USB Host module for the Relay phone.
 * Initiates Android Open Accessory (AOA) protocol to the NoHack phone,
 * then communicates via bulk transfers.
 */
class UsbHostModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "UsbHostModule"

        // AOA constants
        private const val AOA_GET_PROTOCOL = 51
        private const val AOA_SEND_STRING = 52
        private const val AOA_START_ACCESSORY = 53

        // Google AOA vendor/product IDs
        private const val AOA_VENDOR_ID = 0x18D1
        private const val AOA_PRODUCT_ACCESSORY = 0x2D00
        private const val AOA_PRODUCT_ACCESSORY_ADB = 0x2D01

        // AOA string descriptors
        private const val MANUFACTURER = "NoHack"
        private const val MODEL = "NoHack Relay"
        private const val DESCRIPTION = "NoHack USB Communication"
        private const val VERSION = "1.0"
        private const val URI = ""
        private const val SERIAL = "nohack-relay-001"

        private const val ACTION_USB_PERMISSION = "com.nohack.relay.USB_PERMISSION"
        private const val TIMEOUT_MS = 2000
        private const val SCAN_INTERVAL_MS = 3000L
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var connection: UsbDeviceConnection? = null
    private var usbInterface: UsbInterface? = null
    private var endpointIn: UsbEndpoint? = null
    private var endpointOut: UsbEndpoint? = null
    private var readThread: Thread? = null
    @Volatile private var connected = false
    @Volatile private var running = false

    private val scanRunnable = object : Runnable {
        override fun run() {
            if (running && !connected) {
                executor.execute { scanDevices() }
                handler.postDelayed(this, SCAN_INTERVAL_MS)
            }
        }
    }

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Log.d(TAG, "Broadcast received: ${intent.action}")
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    Log.d(TAG, "USB device attached")
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    }
                    if (device != null) handleDevice(device)
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    Log.d(TAG, "USB device detached")
                    closeConnection()
                    sendEvent("usbStatus", "disconnected")
                    // Restart scanning for reconnection
                    startPeriodicScan()
                }
                ACTION_USB_PERMISSION -> {
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    }
                    Log.d(TAG, "USB permission result: granted=$granted device=${device?.deviceName}")
                    if (granted && device != null) {
                        executor.execute { processDevice(device) }
                    } else {
                        Log.e(TAG, "USB permission denied")
                    }
                }
            }
        }
    }

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName() = "UsbHost"

    override fun onHostResume() {
        // Re-scan when app comes to foreground (permission dialog may have been accepted)
        if (running && !connected) {
            executor.execute { scanDevices() }
        }
    }
    override fun onHostPause() {}
    override fun onHostDestroy() {
        closeConnection()
    }

    @ReactMethod
    fun start(promise: Promise) {
        running = true
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            addAction(ACTION_USB_PERMISSION)
        }
        // RECEIVER_EXPORTED needed so the USB permission PendingIntent broadcast is delivered
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactApplicationContext.registerReceiver(usbReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            reactApplicationContext.registerReceiver(usbReceiver, filter)
        }

        // Start periodic scanning until connected
        startPeriodicScan()
        promise.resolve(true)
    }

    @ReactMethod
    fun stop(promise: Promise) {
        running = false
        handler.removeCallbacks(scanRunnable)
        try {
            reactApplicationContext.unregisterReceiver(usbReceiver)
        } catch (_: Exception) {}
        closeConnection()
        promise.resolve(true)
    }

    @ReactMethod
    fun write(data: String, promise: Promise) {
        if (!connected || endpointOut == null || connection == null) {
            promise.resolve(false)
            return
        }
        executor.execute {
            try {
                val bytes = data.toByteArray(Charsets.UTF_8)
                val sent = connection?.bulkTransfer(endpointOut, bytes, bytes.size, TIMEOUT_MS) ?: -1
                promise.resolve(sent >= 0)
            } catch (e: Exception) {
                Log.e(TAG, "Write failed", e)
                closeConnection()
                sendEvent("usbStatus", "disconnected")
                promise.resolve(false)
            }
        }
    }

    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(connected)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    // ── Periodic scanning ───────────────────────────────────────────────────

    private fun startPeriodicScan() {
        handler.removeCallbacks(scanRunnable)
        handler.post(scanRunnable)
    }

    // ── Device scanning ─────────────────────────────────────────────────────

    private fun scanDevices() {
        if (connected) return
        val usbManager = reactApplicationContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val devices = usbManager.deviceList
        if (devices.isNotEmpty()) {
            Log.d(TAG, "Scanning USB devices: found ${devices.size}")
        }

        for ((_, device) in devices) {
            Log.d(TAG, "  Device: ${device.deviceName} vendor=0x${Integer.toHexString(device.vendorId)} product=0x${Integer.toHexString(device.productId)}")
            handleDevice(device)
            if (connected) {
                handler.removeCallbacks(scanRunnable)
                break
            }
        }
    }

    private fun handleDevice(device: UsbDevice) {
        if (connected) return
        requestPermissionAndProcess(device)
    }

    private fun requestPermissionAndProcess(device: UsbDevice) {
        val usbManager = reactApplicationContext.getSystemService(Context.USB_SERVICE) as UsbManager

        if (usbManager.hasPermission(device)) {
            Log.d(TAG, "Already have permission for ${device.deviceName}")
            executor.execute { processDevice(device) }
        } else {
            Log.d(TAG, "Requesting USB permission for ${device.deviceName}")
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pi = PendingIntent.getBroadcast(
                reactApplicationContext, 0,
                Intent(ACTION_USB_PERMISSION).setPackage(reactApplicationContext.packageName),
                flags
            )
            usbManager.requestPermission(device, pi)
        }
    }

    private fun processDevice(device: UsbDevice) {
        if (connected) return

        if (isAoaDevice(device)) {
            Log.d(TAG, "Device is in AOA mode — opening bulk endpoints")
            openAoaDevice(device)
        } else {
            Log.d(TAG, "Device is not in AOA mode — initiating handshake")
            initiateAoa(device)
        }
    }

    // ── AOA Protocol ────────────────────────────────────────────────────────

    private fun isAoaDevice(device: UsbDevice): Boolean {
        return device.vendorId == AOA_VENDOR_ID &&
            (device.productId == AOA_PRODUCT_ACCESSORY || device.productId == AOA_PRODUCT_ACCESSORY_ADB)
    }

    private fun initiateAoa(device: UsbDevice) {
        val usbManager = reactApplicationContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val conn = usbManager.openDevice(device)
        if (conn == null) {
            Log.e(TAG, "Cannot open device for AOA handshake")
            return
        }

        try {
            // Step 1: Get AOA protocol version
            val buffer = ByteArray(2)
            val transferred = conn.controlTransfer(
                UsbConstants.USB_DIR_IN or UsbConstants.USB_TYPE_VENDOR,
                AOA_GET_PROTOCOL, 0, 0, buffer, 2, TIMEOUT_MS
            )

            if (transferred < 0) {
                Log.e(TAG, "GET_PROTOCOL failed (result=$transferred) — device may not support AOA")
                conn.close()
                return
            }

            val protocol = buffer[0].toInt() or (buffer[1].toInt() shl 8)
            Log.d(TAG, "AOA protocol version: $protocol")

            if (protocol < 1) {
                Log.e(TAG, "Device does not support AOA (protocol=$protocol)")
                conn.close()
                return
            }

            // Step 2: Send identifying strings
            sendAoaString(conn, 0, MANUFACTURER)
            sendAoaString(conn, 1, MODEL)
            sendAoaString(conn, 2, DESCRIPTION)
            sendAoaString(conn, 3, VERSION)
            sendAoaString(conn, 4, URI)
            sendAoaString(conn, 5, SERIAL)

            // Step 3: Start accessory mode — device will re-enumerate
            val result = conn.controlTransfer(
                UsbConstants.USB_DIR_OUT or UsbConstants.USB_TYPE_VENDOR,
                AOA_START_ACCESSORY, 0, 0, null, 0, TIMEOUT_MS
            )
            Log.d(TAG, "START_ACCESSORY result: $result")

            conn.close()

            // The device will disconnect and reconnect as an AOA device.
            // The BroadcastReceiver will pick it up via USB_DEVICE_ATTACHED.
            Log.d(TAG, "AOA handshake sent — waiting for device to re-enumerate...")

        } catch (e: Exception) {
            Log.e(TAG, "AOA handshake failed", e)
            try { conn.close() } catch (_: Exception) {}
        }
    }

    private fun sendAoaString(conn: UsbDeviceConnection, index: Int, value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        val buf = ByteArray(bytes.size + 1)
        System.arraycopy(bytes, 0, buf, 0, bytes.size)
        buf[bytes.size] = 0

        val result = conn.controlTransfer(
            UsbConstants.USB_DIR_OUT or UsbConstants.USB_TYPE_VENDOR,
            AOA_SEND_STRING, 0, index, buf, buf.size, TIMEOUT_MS
        )
        if (result < 0) {
            Log.w(TAG, "SEND_STRING index=$index failed: $result")
        }
    }

    // ── AOA Device Communication ────────────────────────────────────────────

    private fun openAoaDevice(device: UsbDevice) {
        val usbManager = reactApplicationContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val conn = usbManager.openDevice(device)
        if (conn == null) {
            Log.e(TAG, "Cannot open AOA device")
            return
        }

        // Find bulk endpoints
        var bulkIn: UsbEndpoint? = null
        var bulkOut: UsbEndpoint? = null
        var iface: UsbInterface? = null

        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            for (j in 0 until intf.endpointCount) {
                val ep = intf.getEndpoint(j)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                    if (ep.direction == UsbConstants.USB_DIR_IN) {
                        bulkIn = ep
                    } else {
                        bulkOut = ep
                    }
                }
            }
            if (bulkIn != null && bulkOut != null) {
                iface = intf
                break
            }
        }

        if (bulkIn == null || bulkOut == null || iface == null) {
            Log.e(TAG, "Could not find bulk endpoints on AOA device (interfaces=${device.interfaceCount})")
            conn.close()
            return
        }

        if (!conn.claimInterface(iface, true)) {
            Log.e(TAG, "Failed to claim interface")
            conn.close()
            return
        }

        connection = conn
        usbInterface = iface
        endpointIn = bulkIn
        endpointOut = bulkOut
        connected = true

        Log.d(TAG, "AOA device opened — bulk IN=${bulkIn.endpointNumber} OUT=${bulkOut.endpointNumber}")
        sendEvent("usbStatus", "connected")
        startReading()
    }

    private fun startReading() {
        readThread = Thread {
            val buffer = ByteArray(16384)
            try {
                while (connected && !Thread.currentThread().isInterrupted) {
                    val bytesRead = connection?.bulkTransfer(endpointIn, buffer, buffer.size, TIMEOUT_MS) ?: -1
                    if (bytesRead > 0) {
                        val data = String(buffer, 0, bytesRead, Charsets.UTF_8)
                        sendEvent("usbData", data)
                    }
                }
            } catch (e: Exception) {
                if (connected) Log.e(TAG, "Read error", e)
            }
            if (connected) {
                connected = false
                sendEvent("usbStatus", "disconnected")
            }
        }.also { it.isDaemon = true; it.start() }
    }

    private fun closeConnection() {
        connected = false
        readThread?.interrupt()
        readThread = null
        try {
            usbInterface?.let { connection?.releaseInterface(it) }
        } catch (_: Exception) {}
        try { connection?.close() } catch (_: Exception) {}
        connection = null
        usbInterface = null
        endpointIn = null
        endpointOut = null
    }

    private fun sendEvent(eventName: String, data: String) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, data)
        } catch (_: Exception) {}
    }
}
