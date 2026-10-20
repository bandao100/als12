package com.example.reseaumonitor

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import java.text.DateFormat
import java.util.Date

class DeviceAdapter(private val onClick: (Device) -> Unit) :
    ListAdapter<Device, DeviceAdapter.ViewHolder>(DIFF) {

    private val timeFormat = DateFormat.getTimeInstance(DateFormat.SHORT)

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.deviceTitle)
        val subtitle: TextView = view.findViewById(R.id.deviceSubtitle)
        val badge: TextView = view.findViewById(R.id.deviceBadge)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder =
        ViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_device, parent, false))

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val device = getItem(position)
        holder.title.text = device.id
        holder.subtitle.text = holder.itemView.context.getString(
            R.string.device_subtitle,
            device.ip,
            timeFormat.format(Date(device.lastSeen)),
        )
        holder.badge.setText(if (device.trusted) R.string.badge_trusted else R.string.badge_unknown)
        holder.itemView.setOnClickListener { onClick(device) }
    }

    private companion object {
        val DIFF = object : DiffUtil.ItemCallback<Device>() {
            override fun areItemsTheSame(oldItem: Device, newItem: Device) = oldItem.id == newItem.id

            override fun areContentsTheSame(oldItem: Device, newItem: Device) = oldItem == newItem
        }
    }
}
