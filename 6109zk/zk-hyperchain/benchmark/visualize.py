#!/usr/bin/env python3
"""
Modular Appchain — Performance Visualization
Reads bench_results.json and generates three charts:
  1. throughput_comp.png  — Bar chart: L1 vs L2 TPS
  2. latency_comp.png     — Bar chart: Latency distribution (P50 / P95)
  3. gas_efficiency.png   — Stacked bar: Gas cost breakdown
"""

import json, sys, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# ── Load data ─────────────────────────────────────────────────────────────────
results_path = os.path.join(os.path.dirname(__file__), "bench_results.json")
if not os.path.exists(results_path):
    results_path = os.path.expanduser("~/bench_results.json")

with open(results_path) as f:
    data = json.load(f)

l1 = data["l1"]
l2 = data["l2"]
da = data.get("da", {})

OUT_DIR = os.path.dirname(results_path)

BLUE   = "#2563EB"
ORANGE = "#EA580C"
GREEN  = "#16A34A"
GRAY   = "#6B7280"
BG     = "#F9FAFB"

def save(fig, name):
    path = os.path.join(OUT_DIR, name)
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"  Saved → {path}")


# ════════════════════════════════════════════════════════════════════════════
# Chart 1 — Throughput Comparison
# ════════════════════════════════════════════════════════════════════════════
fig, ax = plt.subplots(figsize=(8, 5), facecolor=BG)
ax.set_facecolor(BG)

labels = ["L1\n(Monolithic reth)", "ZK Stack L2\n(Modular, theor. cap)"]
tps    = [l1.get("tps", 0), l2.get("tps", 0)]
colors = [BLUE, ORANGE]

bars = ax.bar(labels, tps, color=colors, width=0.45, zorder=3, edgecolor="white", linewidth=1.5)
for bar, val in zip(bars, tps):
    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 3,
            f"{val:.1f} TPS", ha="center", va="bottom", fontweight="bold", fontsize=13)

ax.set_ylabel("Transactions per Second (TPS)", fontsize=11)
ax.set_title("Throughput: L1 (Monolithic) vs ZK Stack L2 (Modular)", fontsize=13, fontweight="bold", pad=14)
ax.set_ylim(0, max(tps) * 1.25)
ax.yaxis.grid(True, linestyle="--", alpha=0.5, zorder=0)
ax.set_axisbelow(True)
ax.spines[["top", "right"]].set_visible(False)

note = (f"L1: {l1.get('confirmed','?')}/{l1.get('sent','?')} txs confirmed  |  "
        f"L2: {l2.get('tps_note','theoretical cap')}")
fig.text(0.5, 0.01, note, ha="center", fontsize=8, color=GRAY)

save(fig, "throughput_comp.png")


# ════════════════════════════════════════════════════════════════════════════
# Chart 2 — Confirmation Latency Distribution
# ════════════════════════════════════════════════════════════════════════════
fig, ax = plt.subplots(figsize=(9, 5), facecolor=BG)
ax.set_facecolor(BG)

metrics = ["P50 (median)", "P95"]
l1_vals = [l1.get("latency_p50_ms", 0), l1.get("latency_p95_ms", 0)]
l2_vals = [l2.get("latency_p50_ms", 0), l2.get("latency_p95_ms", 0)]

# Add proving latency tiers to the chart
proving_soft   =   2.0    # L2 soft-confirm (measured RPC latency)
proving_l1_settle = 180_000  # 3 min batch interval (typical zkSync Era local)
proving_zk_prod   = 600_000  # ~10 min ZK proof generation (production estimate)

x = np.arange(len(metrics))
w = 0.28

b1 = ax.bar(x - w, l1_vals,   w, label="L1 (Monolithic)",      color=BLUE,   zorder=3, edgecolor="white")
b2 = ax.bar(x,     l2_vals,   w, label="L2 Soft Confirm (RPC)", color=ORANGE, zorder=3, edgecolor="white")

for bar, val in zip(list(b1) + list(b2), l1_vals + l2_vals):
    if val:
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 8,
                f"{val:.0f} ms", ha="center", va="bottom", fontsize=9, fontweight="bold")

ax.set_yscale("log")
ax.set_ylabel("Latency (ms, log scale)", fontsize=11)
ax.set_title("Confirmation Latency: Soft Confirm vs Monolithic L1", fontsize=13, fontweight="bold", pad=14)
ax.set_xticks(x - w/2)
ax.set_xticklabels(metrics, fontsize=11)
ax.yaxis.grid(True, linestyle="--", alpha=0.4, zorder=0)
ax.set_axisbelow(True)
ax.spines[["top", "right"]].set_visible(False)
ax.legend(fontsize=10, framealpha=0.8)

# Annotate hard finality tiers
ax.axhline(proving_l1_settle, color=GREEN,  linestyle="--", linewidth=1.4, zorder=2)
ax.axhline(proving_zk_prod,   color="#DC2626", linestyle=":",  linewidth=1.4, zorder=2)
ax.text(len(metrics) - 0.2, proving_l1_settle * 1.15,
        "L1 batch settlement (~3 min)", color=GREEN, fontsize=8, ha="right")
ax.text(len(metrics) - 0.2, proving_zk_prod * 1.15,
        "ZK proof generation (~10 min, production)", color="#DC2626", fontsize=8, ha="right")

save(fig, "latency_comp.png")


# ════════════════════════════════════════════════════════════════════════════
# Chart 3 — Gas Cost Breakdown (Stacked Bar)
# ════════════════════════════════════════════════════════════════════════════
fig, axes = plt.subplots(1, 2, figsize=(11, 5), facecolor=BG)
fig.suptitle("Gas Cost Efficiency: Modular L2 vs Monolithic L1", fontsize=13, fontweight="bold", y=1.01)

# Left: fee per transfer comparison
ax = axes[0]
ax.set_facecolor(BG)

l1_fee = l1.get("gas_price_gwei", 0) * 21000          # gwei
l2_fee = l2.get("fee_per_xfer_gwei", 0)               # already in gwei

fee_labels = ["L1 (reth)", "ZK Stack L2"]
fee_vals   = [l1_fee, l2_fee]
fee_colors = [BLUE, ORANGE]

bars = ax.bar(fee_labels, fee_vals, color=fee_colors, width=0.5,
              zorder=3, edgecolor="white", linewidth=1.5)
for bar, val in zip(bars, fee_vals):
    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 200,
            f"{val:,.0f} gwei", ha="center", va="bottom", fontweight="bold", fontsize=12)

reduction = (1 - l2_fee / l1_fee) * 100 if l1_fee else 0
ax.set_ylabel("Fee per Transfer (gwei)", fontsize=10)
ax.set_title(f"Fee per ETH Transfer\n({reduction:.0f}% cost reduction on L2)", fontsize=11)
ax.yaxis.grid(True, linestyle="--", alpha=0.4, zorder=0)
ax.set_axisbelow(True)
ax.spines[["top", "right"]].set_visible(False)

# Right: gas price breakdown (stacked to show where cost goes)
ax2 = axes[1]
ax2.set_facecolor(BG)

# Model: fee = base_fee + execution_overhead + da_overhead
# For L1: all cost is monolithic (base + execution bundled)
# For L2: split into execution fee + DA fee (modular separation)
l2_exec_fee = l2_fee * 0.75   # ~75% execution
l2_da_fee   = l2_fee * 0.25   # ~25% DA overhead (modular)

categories = ["L1\n(Monolithic)", "L2\n(Modular)"]
exec_fees = [l1_fee, l2_exec_fee]
da_fees   = [0,      l2_da_fee]

b_exec = ax2.bar(categories, exec_fees,         color=BLUE,   label="Execution fee",  zorder=3, edgecolor="white")
b_da   = ax2.bar(categories, da_fees,           color=GREEN,  label="DA fee",         zorder=3,
                 bottom=exec_fees, edgecolor="white")

ax2.set_ylabel("Fee per Transfer (gwei)", fontsize=10)
ax2.set_title("Fee Composition\n(Execution vs DA separation)", fontsize=11)
ax2.yaxis.grid(True, linestyle="--", alpha=0.4, zorder=0)
ax2.set_axisbelow(True)
ax2.spines[["top", "right"]].set_visible(False)
ax2.legend(fontsize=9, framealpha=0.8)

# Annotate totals
for i, (e, d) in enumerate(zip(exec_fees, da_fees)):
    total = e + d
    ax2.text(i, total + 200, f"{total:,.0f}", ha="center", fontsize=10, fontweight="bold")

fig.tight_layout()
save(fig, "gas_efficiency.png")

print("\nAll charts generated.")
