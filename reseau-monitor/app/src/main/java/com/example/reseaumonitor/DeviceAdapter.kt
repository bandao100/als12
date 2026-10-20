package com.example.reseaumonitor

import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView

/** Ligne de la liste : l'état en ligne fait partie du contenu comparé, pour être rafraîchi. */
data class DeviceRow(val device: Device, val online: Boolean)

class DeviceAdapter(private val onClick: (Device) -> Unit) :
    ListAdapter<DeviceRow, DeviceAdapter.ViewHolder>(DIFF) {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.deviceTitle)
        val subtitle: TextView = view.findViewById(R.id.deviceSubtitle)
        val onlineBadge: TextView = view.findViewById(R.id.onlineBadge)
        val trustBadge: TextView = view.findViewById(R.id.trustBadge)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder =
        ViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_device, parent, false))

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val (device, online) = getItem(position)
        val context = holder.itemView.context

        val details = buildList {
            add(device.ip)
            if (device.id != device.ip) add(device.id)
            if (!online) {
                val seenAgo = DateUtils.getRelativeTimeSpanString(
                    device.lastSeen,
                    System.currentTimeMillis(),
                    DateUtils.MINUTE_IN_MILLIS,
                )
                add(context.getString(R.string.seen_ago, seenAgo))
            }
        }

        holder.title.text = device.displayName
        holder.subtitle.text = details.joinToString(" · ")

        holder.onlineBadge.setText(if (online) R.string.badge_online else R.string.badge_offline)
        holder.onlineBadge.setTextColor(
            ContextCompat.getColor(context, if (online) R.color.status_online else R.color.status_offline),
        )
        holder.trustBadge.setText(if (device.trusted) R.string.badge_trusted else R.string.badge_unknown)
        holder.trustBadge.setTextColor(
            ContextCompat.getColor(context, if (device.trusted) R.color.status_trusted else R.color.status_unknown),
        )

        holder.itemView.setOnClickListener { onClick(device) }
    }

    private companion object {
        val DIFF = object : DiffUtil.ItemCallback<DeviceRow>() {
            override fun areItemsTheSame(oldItem: DeviceRow, newItem: DeviceRow) =
                oldItem.device.id == newItem.device.id

            override fun areContentsTheSame(oldItem: DeviceRow, newItem: DeviceRow) = oldItem == newItem
        }
    }
}
