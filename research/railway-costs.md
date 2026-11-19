# Railway costs for public HTTP video streaming

**Issue:** [BalaStic/waczak-tv#19](https://github.com/BalaStic/waczak-tv/issues/19)
**Checked:** 2026-11-19 against the official Railway documentation and policy pages linked below.

## Scope and answer

This estimates Railway platform charges for an always-on public service in Europe with a persistent Railway volume and HTTP video delivery. The actual library size, bitrate, and viewer-hours are unknown, so this report does not assign values to them or claim a monthly total. Pricing is in USD before any applicable tax/VAT. Railway says applicable tax/VAT depends on billing location and appears on the invoice ([Pricing FAQs](https://docs.railway.com/pricing/faqs)).

Railway lists **EU West Metal in Amsterdam** (`europe-west4-drams3a`) as its European deployment region. A volume follows its service's region; changing regions with an attached volume requires migration and causes downtime. The pricing table lists one rate per resource, not separate regional rates; it does not explicitly state that every region has identical billing ([Regions](https://docs.railway.com/deployments/regions), [Pricing Plans](https://docs.railway.com/pricing/plans)).

For an always-on service, budget the plan subscription plus measured resource use. A 24/7 service should not be costed on the assumption that it will sleep: Railway's Free plan is described as intended for small apps that can sleep when idle and includes only $1 of usage per month ([Pricing Plans](https://docs.railway.com/pricing/plans)). Serverless can stop inactive services to reduce cost, but an always-available streaming service cannot assume it will be inactive ([Cost Control](https://docs.railway.com/pricing/cost-control)).

## Current listed prices and relevant limits

| Item | Current published charge | Relevant published limit or caveat |
|---|---:|---|
| Hobby subscription | $5/month, including $5/month resource usage | Per-service maximums: 48 GB RAM, 48 vCPU, 100 GB ephemeral storage; volume default 5 GB. |
| Pro subscription | $20/month, including $20/month resource usage | Per-service maximums: 1 TB RAM, 1,000 vCPU, 100 GB ephemeral storage; see volume-size discrepancy below. |
| RAM | $10/GB-month; $0.000231/GB-minute | Actual resource consumption is billed. |
| CPU | $20/vCPU-month; $0.000463/vCPU-minute | Actual resource consumption is billed. |
| Volume storage | $0.15/GB-month; $0.000003472222222/GB-minute | Charged on storage used, not provisioned capacity. Filesystem metadata uses approximately 2–3% of volume size. |
| Public network egress | $0.05/GB | No free egress allowance is listed separately; plan included-usage credit applies to resource use. |

Source for prices, plan credits, and per-service maxima: [Railway Pricing Plans](https://docs.railway.com/pricing/plans). Volume-specific price basis and metadata note: [Railway Volumes reference](https://docs.railway.com/volumes/reference).

**Volume size detail:** the volumes reference lists defaults of 0.5 GB on Free/Trial, 5 GB on Hobby, and 50 GB on Pro; it says Pro can self-serve resize to 1 TB. The plan pricing table instead shows Pro volume storage as “1 TB*” and its footnote says Pro and above can self-serve to 1 TB. Use the volume-reference 50 GB as the documented Pro default and confirm the current dashboard behavior before provisioning; the 1 TB figure is the self-serve ceiling, not a measured library size ([Volumes reference](https://docs.railway.com/volumes/reference), [Pricing Plans](https://docs.railway.com/pricing/plans)). Volumes cannot be downsized.

Other volume constraints: one volume per service; replicas cannot be used with a volume; 3,000 read IOPS and 3,000 write IOPS for all volume sizes and plans. The reference does not publish an I/O throughput (MB/s) figure. Redeploys have a small amount of downtime because overlapping deployments cannot mount the same volume; if a volume reaches 100% full, an automatic offline resize can restart the service ([Volumes reference](https://docs.railway.com/volumes/reference)).

**Usage credit / invoice:** Hobby includes $5 and Pro includes $20 of resource usage each billing cycle; if resource use is below the credit, the subscription fee still applies, and overage is billed above it. In this case, estimate the service's resource use as RAM + CPU + volume + egress, and account for any other workloads sharing the plan's usage credit. Thus, before taxes, the simple plan-and-usage total is `max(monthly plan fee, total billed resource usage)` for these plans ([Pricing Plans](https://docs.railway.com/pricing/plans)).

## Egress and HTTP streaming limits

Railway lists public network egress at **$0.05/GB**. Its [public networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits) publish HTTP request-rate and connection request limits, but no bandwidth/throughput cap. This means no bandwidth cap was found in the cited public-networking specification; it is not a guarantee of unlimited throughput or a statement about other contractual limits. There is no video-specific bandwidth allowance stated in the pages checked.

The edge supports HTTP/1.1 and HTTP/2. An HTTP request may run for up to 15 minutes if data keeps transferring; otherwise, it closes after 5 minutes with no data transferred. Idle HTTP/1.1 connections close after 60 seconds between requests; the page exempts HTTP/2 and WebSockets from that idle-connection rule. Requests are limited to approximately 11,000 requests/second per domain and 10,000 requests per connection, with combined headers limited to 32 KB. Inbound traffic must use HTTPS/TLS 1.2 or newer ([Public Networking Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)).

**Streaming implication:** a single progressive-download HTTP response lasting longer than 15 minutes should not be assumed to remain open; the application/player needs to reconnect (for example with range requests) or use shorter segmented requests. This is an implication of the documented request duration, not a Railway guarantee about a particular video format or player.

## Transparent monthly estimate

Use measured service consumption over a billing cycle. For minute-based quantities, sum the observed consumption by minute (or use an equivalent measured monthly aggregate):

```text
RAM_cost      = sum(RAM_GB_used_each_minute) × $0.000231
CPU_cost      = sum(vCPU_used_each_minute) × $0.000463
Volume_cost   = sum(volume_GB_used_each_minute) × $0.000003472222222
Egress_cost   = measured_public_egress_GB × $0.05
Resource_use  = RAM_cost + CPU_cost + Volume_cost + Egress_cost
Bill_before_tax = max(plan_subscription_fee, total_plan_resource_use)
```

The `total_plan_resource_use` should include all usage counted against the plan, not just this service. The pricing page also gives monthly equivalents: RAM `$10 × GB-month`, CPU `$20 × vCPU-month`, volume `$0.15 × GB-month`. The per-minute version avoids assuming a billing month has a fixed number of minutes ([Pricing Plans](https://docs.railway.com/pricing/plans)).

For a payload-based egress estimate only, let `V` be viewer-hours in the billing cycle and `B` the average delivered bitrate in decimal Mbps:

```text
estimated payload egress_GB = V × B × 0.45
estimated egress cost       = (V × B × 0.45 ÷ 1.073741824) × $0.05
```

The factor `0.45` is a unit conversion: `1 Mbps × 3,600 seconds/hour ÷ 8 bits/byte ÷ 1,000,000,000 bytes/decimal-GB`. It is not a Railway measurement. The pricing page also lists `$0.000000047683716/KB`; that rate is equivalent to `$0.05` per 1,048,576 KB, which implies a binary-sized billing GB, although the docs do not explicitly define the unit. On that interpretation, estimated egress cost is `decimal payload GB ÷ 1.073741824 × $0.05`. Use Railway's reported egress and usage charges for a reliable estimate. Bitrate varies by viewer and time, and network bytes can differ from watched payload because of buffering, retries, range requests, or protocol overhead ([Pricing Plans](https://docs.railway.com/pricing/plans)).

`1–10 concurrent viewers` describes simultaneous connections, not monthly viewer-hours. Compute viewer-hours from actual concurrency over time. For context only, continuous viewing by 10 viewers throughout a 730-hour month would be 7,300 viewer-hours; this is a mathematical ceiling example, not a forecast or an assumed service load. A calendar billing cycle may have a different number of hours.

## Measurements needed for a reliable estimate

1. **Library/storage:** actual occupied volume GB now, expected growth, filesystem overhead, and the volume size/plan needed. Prefer observed used volume over library file sizes alone.
2. **Delivered bitrate:** average and peak Mbps per viewer, including adaptive-bitrate representation and any transcoding. Do not infer this from library size.
3. **Viewing:** viewer-hours by billing cycle (or a concurrency time series), not just maximum concurrent viewers.
4. **Actual bytes:** Railway Workspace Usage network egress after representative service use; compare with the payload formula to capture retries, range requests, buffering, and overhead.
5. **Runtime:** observed average/peak RAM GB and CPU vCPU usage under representative concurrent streams, plus whether the process remains active around the clock.
6. **Capacity checks:** test volume IOPS and application/network performance under expected concurrency. Railway publishes volume IOPS but not throughput, and the volume-backed service cannot use replicas ([Volumes reference](https://docs.railway.com/volumes/reference)).

Railway itself recommends deploying on Trial or Hobby, running for one week, then checking Estimated Usage in Workspace Usage and extrapolating; it says it cannot provide an exact quote because usage depends on the deployed workload ([Pricing FAQs](https://docs.railway.com/pricing/faqs)). A hard usage limit can take all workloads offline when reached, so configure it only with that availability risk in mind ([Cost Control](https://docs.railway.com/pricing/cost-control)).

## Policy note

Railway's Acceptable Use Policy prohibits hosting copyrighted or pirated media without proper authorization from the rights holder ([Acceptable Use Policy](https://railway.com/legal/acceptable-use)).

## Official sources

- [Pricing Plans](https://docs.railway.com/pricing/plans)
- [Volumes reference](https://docs.railway.com/volumes/reference)
- [Public Networking Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)
- [Regions](https://docs.railway.com/deployments/regions)
- [Cost Control](https://docs.railway.com/pricing/cost-control)
- [Pricing FAQs](https://docs.railway.com/pricing/faqs)
- [Acceptable Use Policy](https://railway.com/legal/acceptable-use)
