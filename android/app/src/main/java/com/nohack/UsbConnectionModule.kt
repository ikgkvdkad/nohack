package com.nohack

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbAccessory
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.Executors

class UsbConnectionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "UsbConnectionModule"
        private const val POLL_INTERVAL_MS = 2000L
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var fileDescriptor: ParcelFileDescriptor? = null
    private var inputStream: FileInputStream? = null
    private var outputStream: FileOutputStream? = null
    private var readThread: Thread? = null
    @Volatile private var connected = false
    @Volatile private var running = false

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (running && !connected) {
                executor.execute { tryOpenAccessory() }
                handler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }
    }

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                UsbManager.ACTION_USB_ACCESSORY_ATTACHED -> {
                    Log.d(TAG, "USB accessory attached (broadcast)")
                    executor.execute { tryOpenAccessory() }
                }
                UsbManager.ACTION_USB_ACCESSORY_DETACHED -> {
                    Log.d(TAG, "USB accessory detached")
                    closeConnection()
                    sendEvent("usbStatus", "disconnected")
                    startPolling()
                }
            }
        }
    }

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName() = "UsbConnection"

    override fun onHostResume() {
        // Re-check when app comes to foreground
        if (running && !connected) {
            executor.execute { tryOpenAccessory() }
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
            addAction(UsbManager.ACTION_USB_ACCESSORY_ATTACHED)
            addAction(UsbManager.ACTION_USB_ACCESSORY_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactApplicationContext.registerReceiver(usbReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            reactApplicationContext.registerReceiver(usbReceiver, filter)
        }

        // Start polling for accessories (AOA handshake may happen after we start)
        startPolling()
        promise.resolve(true)
    }

    @ReactMethod
    fun stop(promise: Promise) {
        running = false
        handler.removeCallbacks(pollRunnable)
        try {
            reactApplicationContext.unregisterReceiver(usbReceiver)
        } catch (_: Exception) {}
        closeConnection()
        promise.resolve(true)
    }

    @ReactMethod
    fun write(data: String, promise: Promise) {
        if (!connected || outputStream == null) {
            promise.resolve(false)
            return
        }
        executor.execute {
            try {
                val bytes = (data).toByteArray(Charsets.UTF_8)
                outputStream?.write(bytes)
                outputStream?.flush()
                promise.resolve(true)
            } catch (e: IOException) {
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

    private fun startPolling() {
        handler.removeCallbacks(pollRunnable)
        handler.post(pollRunnable)
    }

    private fun tryOpenAccessory() {
        if (connected) return

        val usbManager = reactApplicationContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val accessories = usbManager.accessoryList
        if (accessories.isNullOrEmpty()) {
            return
        }

        val accessory = accessories[0]
        Log.d(TAG, "Found accessory: ${accessory.manufacturer} ${accessory.model}")

        val fd = usbManager.openAccessory(accessory)
        if (fd == null) {
            Log.e(TAG, "Failed to open accessory")
            return
        }

        fileDescriptor = fd
        inputStream = FileInputStream(fd.fileDescriptor)
        outputStream = FileOutputStream(fd.fileDescriptor)
        connected = true
        handler.removeCallbacks(pollRunnable)

        Log.d(TAG, "Accessory opened successfully")
        sendEvent("usbStatus", "connected")
        startReading()
    }

    private fun startReading() {
        readThread = Thread {
            val buffer = ByteArray(16384)
            try {
                while (connected && !Thread.currentThread().isInterrupted) {
                    val bytesRead = inputStream?.read(buffer) ?: -1
                    if (bytesRead == -1) break
                    if (bytesRead > 0) {
                        val data = String(buffer, 0, bytesRead, Charsets.UTF_8)
                        sendEvent("usbData", data)
                    }
                }
            } catch (e: IOException) {
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
        try { inputStream?.close() } catch (_: Exception) {}
        try { outputStream?.close() } catch (_: Exception) {}
        try { fileDescriptor?.close() } catch (_: Exception) {}
        inputStream = null
        outputStream = null
        fileDescriptor = null
    }

    private fun sendEvent(eventName: String, data: String) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, data)
        } catch (_: Exception) {}
    }
}
