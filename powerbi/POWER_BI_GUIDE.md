# Power BI integration guide

## Refresh source

Run `rebuildReportingData()` as an administrator, then run `validateReportingCertification()`. Import **only** these Google Sheets tabs with Power BI's Google Sheets connector: `ReportProduction`, `ReportTasks`, `ReportDepartmentPerformance`, `ReportOrderCycleTime`, `ReportDelivery`, and `ReportDailyProduction`.

In Power BI Desktop choose **Get data → Google Sheets**, paste the Production spreadsheet URL, sign in with the Google account that has read access, and select only the six report tabs. Use **Import** mode. In Power BI Service, configure the Google credential and refresh schedule for the semantic model. Rebuild the reporting tabs before each scheduled Power BI refresh; the connector reads the current contents of the report tabs.

Do not use Publish to web, CSV publishing, the backup spreadsheet, or any transactional tab as a Power BI source.

## Power Query shaping

- Keep all IDs and statuses as Text.
- Convert quantities/counts to Whole Number; percentages and durations to Decimal Number.
- Convert `Date` to Date; convert timestamp fields to Date/Time, preserving the source's Asia/Kolkata operational interpretation.
- Create `DimDepartment` from the distinct `Department ID` and `Department Name` fields in `ReportDepartmentPerformance`.
- Create `DimDate` as a contiguous calendar spanning the imported report date columns. Mark it as the model date table.
- Remove blank IDs and reject duplicate fact keys during refresh rather than silently deduplicating them.

## Relationships

Follow `PowerBIModel.json`. All relationships are one-to-many, single direction, from `DimDate` or `DimDepartment` to facts. Do not create fact-to-fact or bidirectional relationships. `FactDelivery` is a metric-snapshot fact, not an order-level fact.

## Measures and baseline validation

Import `CoreMeasures.dax`. With the acceptance dataset the cards must show:

| Measure | Expected |
|---|---:|
| Total Orders | 2 |
| Completed Orders | 1 |
| Active Orders | 1 |
| Production Quantity | 20 |
| Completed Quantity | 10 |
| WIP Quantity | 10 |

The `Completed Quantity` measure intentionally filters final `COMPLETED` orders. Never use task-stage or department-stage quantities for this KPI.

## Report pages

Build these pages in Power BI Desktop using measures rather than implicit aggregations for KPI values.

### 1. Executive Overview

- Cards: `Total Orders`, `Completed Orders`, `Active Orders`, `Production Quantity`, `Completed Quantity`, `WIP Quantity`.
- Donut: `FactProduction[Order Status]` by `[Total Orders]`.
- Line chart: `DimDate[Date]` by `[Department Throughput]`.
- Bar chart: `DimDepartment[Department Name]` by `[Department Throughput]`.
- Add a `DimDate[Date]` slicer. Confirm it filters the daily trend and date-connected facts without double-counting order quantities.

### 2. Production Tracking

- Table: Order ID, Product ID, Product Name, Customer ID, Customer Name, Current Department ID, Order Quantity, Completed Quantity, Remaining Quantity, Order Status, Priority, Order Date, Required Delivery Date, Completion Date.
- Cards: `Completed Quantity`, `WIP Quantity`, `Completion %`.
- Slicers: Order Status, Priority, `DimDate[Date]`.
- Use columns only for row detail; retain measures for totals.

### 3. Department Performance

- Department slicer: `DimDepartment[Department Name]`.
- Cards: `Completed Tasks`, `Pending Tasks`, `Overdue Tasks`, `Department Throughput`, `Average Task Duration`.
- Clustered column chart: Department Name by `Completed Tasks`, `Pending Tasks`, and `Overdue Tasks`.
- Bar chart: Department Name by `Department Throughput`.
- Never sum department task quantities as final completed production.

### 4. Delivery Performance

- Cards: `On-Time Delivery %`, `Completed Orders`, `Active Orders`, `Late Orders`, `Average Delivery Delay Hours`.
- Column chart: Order ID by `FactProduction[Delay Hours]`, filtered to completed orders.
- Table: Order ID, Required Delivery Date, Completion Date, On Time, Delay Hours, Order Status.
- Use a date slicer and confirm the active relationship reflects order date; use inactive date relationships only through explicit measures if analysing completion or due dates.

### 5. Cycle Time / Bottlenecks

- Cards: `Average Cycle Time`, `Average Stage Duration`.
- Matrix: Order ID → Department ID with `FactOrderCycle[Stage Duration Hours]` and `FactOrderCycle[Total Cycle Hours]`.
- Bar chart: Department Name by `Average Stage Duration`; sort descending to identify the bottleneck.
- Add Department and Date slicers. Do not create fact-to-fact relationships to make this work.

## Desktop acceptance

Before publishing, refresh the model and confirm:

| KPI | Expected baseline |
|---|---:|
| Total Orders | 2 |
| Completed Orders | 1 |
| Active Orders | 1 |
| Production Quantity | 20 |
| Completed Quantity | 10 |
| WIP Quantity | 10 |

Also verify that every visual responds to its relevant slicer, IDs have no blanks/orphans, and the refresh does not change relationships, measures, or page layout. A successful refresh alone does not certify the visual totals; validate the six cards after each source refresh.

## Go-live checklist

1. `validateReportingCertification()` returns success with zero failures.
2. Power Query loads only the six report tabs with no refresh errors.
3. Fact keys have no duplicates and dimension IDs have no blanks/orphans.
4. The six baseline cards match the table above.
5. Configure credential ownership and scheduled refresh in Power BI Service.
