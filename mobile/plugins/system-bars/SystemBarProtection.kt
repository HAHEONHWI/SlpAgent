package dev.heonhwi.slpai

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import android.view.Window
import android.view.WindowManager
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// SDK color requests draw inset protection instead of using deprecated Window bar colors.
internal class SystemBarProtection private constructor(private val decor: View) :
    Drawable(), ViewTreeObserver.OnPreDrawListener, View.OnAttachStateChangeListener {
    private val paint = Paint()
    private var drawableAlpha = 255
    private var statusInsets = Insets.NONE
    private var navigationInsets = Insets.NONE
    private var statusColor = initialColor(android.R.attr.statusBarColor)
    private var navigationColor = initialColor(android.R.attr.navigationBarColor)

    init {
        decor.overlay.add(this)
        decor.addOnAttachStateChangeListener(this)
        if (decor.isAttachedToWindow) onViewAttachedToWindow(decor)
    }

    private fun initialColor(attribute: Int): Int {
        if (Build.VERSION.SDK_INT >= 35) return Color.TRANSPARENT
        val attributes = decor.context.obtainStyledAttributes(intArrayOf(attribute))
        return try { attributes.getColor(0, Color.TRANSPARENT) } finally { attributes.recycle() }
    }

    override fun onViewAttachedToWindow(view: View) {
        view.viewTreeObserver.addOnPreDrawListener(this)
    }

    override fun onViewDetachedFromWindow(view: View) {
        if (view.viewTreeObserver.isAlive) view.viewTreeObserver.removeOnPreDrawListener(this)
    }

    override fun onPreDraw(): Boolean {
        // Older Android decor backgrounds otherwise cover transparent protection.
        decor.findViewById<View>(android.R.id.statusBarBackground)?.let { if (it.alpha != 0f) it.alpha = 0f }
        decor.findViewById<View>(android.R.id.navigationBarBackground)?.let { if (it.alpha != 0f) it.alpha = 0f }
        val insets = ViewCompat.getRootWindowInsets(decor)
        val status = insets?.getInsets(WindowInsetsCompat.Type.statusBars()) ?: Insets.NONE
        val navigation = insets?.getInsets(WindowInsetsCompat.Type.navigationBars()) ?: Insets.NONE
        if (status != statusInsets || navigation != navigationInsets ||
            bounds.width() != decor.width || bounds.height() != decor.height) {
            statusInsets = status
            navigationInsets = navigation
            setBounds(0, 0, decor.width, decor.height)
            invalidateSelf()
        }
        return true
    }

    override fun draw(canvas: Canvas) {
        drawInsets(canvas, statusInsets, statusColor)
        drawInsets(canvas, navigationInsets, navigationColor)
    }

    private fun drawInsets(canvas: Canvas, insets: Insets, color: Int) {
        if (Color.alpha(color) == 0) return
        paint.color = color
        paint.alpha = Color.alpha(color) * drawableAlpha / 255
        val width = bounds.width().toFloat()
        val height = bounds.height().toFloat()
        canvas.drawRect(0f, 0f, width, insets.top.toFloat(), paint)
        canvas.drawRect(0f, height - insets.bottom, width, height, paint)
        canvas.drawRect(0f, insets.top.toFloat(), insets.left.toFloat(), height - insets.bottom, paint)
        canvas.drawRect(width - insets.right, insets.top.toFloat(), width, height - insets.bottom, paint)
    }

    override fun setAlpha(alpha: Int) { drawableAlpha = alpha; invalidateSelf() }
    override fun setColorFilter(filter: ColorFilter?) { paint.colorFilter = filter; invalidateSelf() }
    @Deprecated("Drawable API")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    companion object {
        private fun forWindow(window: Window): SystemBarProtection {
            val decor = window.decorView
            val existing = decor.getTag(R.id.slp_system_bar_protection)
            if (existing is SystemBarProtection) return existing
            return SystemBarProtection(decor).also { decor.setTag(R.id.slp_system_bar_protection, it) }
        }

        @JvmStatic fun setStatusBarBackground(window: Window, color: Int) {
            forWindow(window).apply { statusColor = color; invalidateSelf() }
        }
        @JvmStatic fun setNavigationBarBackground(window: Window, color: Int) {
            forWindow(window).apply { navigationColor = color; invalidateSelf() }
        }
        @JvmStatic fun getStatusBarBackground(window: Window): Int = forWindow(window).statusColor
        @JvmStatic fun getNavigationBarBackground(window: Window): Int = forWindow(window).navigationColor

        @JvmStatic fun applyDisplayCutoutMode(attributes: WindowManager.LayoutParams) {
            // ALWAYS exists from API 30; Android 9/10 retain their safe platform default.
            if (Build.VERSION.SDK_INT >= 30) {
                attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
        }
    }
}
