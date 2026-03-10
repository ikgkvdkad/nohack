package com.enigma

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BluetoothDiscoverableModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var promise: Promise? = null

    companion object {
        private const val REQUEST_DISCOVERABLE = 9001
    }

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "BluetoothDiscoverable"

    @ReactMethod
    fun requestDiscoverable(duration: Int, promise: Promise) {
        this.promise = promise
        val intent = Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).apply {
            putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, duration)
        }
        val activity = currentActivity
        if (activity != null) {
            activity.startActivityForResult(intent, REQUEST_DISCOVERABLE)
        } else {
            promise.reject("NO_ACTIVITY", "No current activity")
            this.promise = null
        }
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode == REQUEST_DISCOVERABLE) {
            if (resultCode > 0) {
                // resultCode == duration in seconds when accepted
                promise?.resolve(true)
            } else {
                promise?.resolve(false)
            }
            promise = null
        }
    }

    override fun onNewIntent(intent: Intent?) {}
}
