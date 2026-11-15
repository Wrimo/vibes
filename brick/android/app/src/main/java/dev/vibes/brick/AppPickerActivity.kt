package dev.vibes.brick

import android.app.Activity
import android.content.Intent
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.CheckBox
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView

/** Tick the apps that get blocked. Only reachable while unbricked. */
class AppPickerActivity : Activity() {

    private class AppRow(val pkg: String, val label: String, val icon: Drawable)

    private lateinit var controller: BrickController
    private val selected = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = Brick.controller(this)
        if (controller.isBricked) {
            finish()
            return
        }
        setContentView(R.layout.activity_picker)
        selected += controller.blockedPackages

        // Reading every app's name and icon takes a moment on a full phone.
        Thread {
            val rows = loadApps()
            runOnUiThread { if (!isDestroyed) show(rows) }
        }.start()
    }

    private fun loadApps(): List<AppRow> {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return packageManager.queryIntentActivities(launcher, 0)
            .map { it.activityInfo }
            .filter { it.packageName != packageName }
            .distinctBy { it.packageName }
            .map {
                AppRow(
                    it.packageName,
                    it.applicationInfo.loadLabel(packageManager).toString(),
                    it.applicationInfo.loadIcon(packageManager),
                )
            }
            .sortedWith(
                compareByDescending<AppRow> { it.pkg in selected }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.label }
            )
    }

    private fun show(rows: List<AppRow>) {
        findViewById<View>(R.id.loading).visibility = View.GONE
        val list = findViewById<ListView>(R.id.list)
        val adapter = object : BaseAdapter() {
            override fun getCount() = rows.size
            override fun getItem(position: Int) = rows[position]
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = convertView
                    ?: layoutInflater.inflate(R.layout.item_app, parent, false)
                val row = rows[position]
                view.findViewById<ImageView>(R.id.icon).setImageDrawable(row.icon)
                view.findViewById<TextView>(R.id.label).text = row.label
                view.findViewById<CheckBox>(R.id.check).isChecked = row.pkg in selected
                return view
            }
        }
        list.adapter = adapter
        list.setOnItemClickListener { _, _, position, _ ->
            val pkg = rows[position].pkg
            if (!selected.remove(pkg)) selected += pkg
            controller.setBlockedPackages(selected)
            adapter.notifyDataSetChanged()
        }
    }
}
