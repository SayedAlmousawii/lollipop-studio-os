# 77 F6 INV-18 Investigation Data

Generated: 2026-05-15T16:27:30.294Z

Scope: order `cmp6tm9n30007n7t3ramturmp` / financial case `cmp6tlvc70002n7t3yucyvf96`.

## Reconciliation Reproduction

Command:

```sh
npm run financial:reconcile
```

Exact INV-18 output:

```text
HIGH reconciliation violations detected. Investigate within 24h.
- INV-18 Order cmp6tm9n30007n7t3ramturmp, cmp6tlvc70002n7t3yucyvf96: FinancialCase invoice totals must reconcile to current order totals: expected FINAL + ADJUSTMENT - CREDIT_NOTE equals current order package/add-on total; actual expected=230.000, actual=225.000.
```

Report summary:

```json
{
  "runAt": "2026-05-15T16:23:28.580Z",
  "invoicesChecked": 5,
  "paymentsChecked": 6,
  "allocationsChecked": 6,
  "applicationsChecked": 2,
  "status": "VIOLATIONS_DETECTED"
}
```

## Order And Case

```json
{
  "order": {
    "id": "cmp6tm9n30007n7t3ramturmp",
    "publicId": "ORD-00001",
    "status": "DELIVERED",
    "selectionStatus": "COMPLETED",
    "deliveryStatus": "COMPLETED",
    "bookingId": "cmp6tjsr00000n7t3phi482u3",
    "jobId": "cmp6tm9mq0006n7t3yh8h2xmj",
    "jobNumber": "JOB-NB-2026-00001",
    "createdAt": "2026-05-15T11:15:13.359Z",
    "updatedAt": "2026-05-15T11:26:41.189Z"
  },
  "financialCase": {
    "id": "cmp6tlvc70002n7t3yucyvf96",
    "bookingId": "cmp6tjsr00000n7t3phi482u3",
    "jobId": "cmp6tm9mq0006n7t3yh8h2xmj",
    "createdAt": "2026-05-15T11:14:54.823Z",
    "updatedAt": "2026-05-15T11:15:13.369Z"
  }
}
```

## INV-18 Math

| Component | Amount |
|---|---:|
| Package total | 150.000 |
| Extra photo total | 15.000 |
| Current add-on total | 65.000 |
| Package item upgrade total | 0.000 |
| Expected current order total | 230.000 |
| FINAL total | 230.000 |
| ADJUSTMENT total | 45.000 |
| CREDIT_NOTE total | -50.000 |
| Actual revenue-document total | 225.000 |
| Expected minus actual | 5.000 |

Formula used by INV-18: `FINAL + ADJUSTMENT - CREDIT_NOTE` compared to `package + extra photos + add-ons + upgrades`.

## Packages, Add-Ons, Upgrades

### Order Packages

| id | package | current price | original snapshot | final snapshot | selected/included | extras | createdAt |
|---|---|---:|---:|---:|---:|---:|---|
| `cmp6tm9n40008n7t35h59mlv4` | Basic Package (`pkg-basic`) | 150.000 | 150.000 | null | 25 / 20 | 5 print x 3.000 = 15.000 | 2026-05-15T11:15:13.359Z |

### Order Add-Ons

| id | product | snapshot | current canonical | qty | total | createdAt |
|---|---|---:|---:|---:|---:|---|
| `cmp6tnx7q000qn7t3ah6dd6bc` | Album 30x30 (`addon-album-30x30`) | 65.000 | 65.000 | 1 | 65.000 | 2026-05-15T11:16:30.566Z |

### Package Item Upgrades

None.

## Invoices

| id | number | type | status | total | paid | remaining | locked | parent | createdAt |
|---|---|---|---|---:|---:|---:|---|---|---|
| `cmp6tlvcb0003n7t30b69mb8m` | DEP-00001 | DEPOSIT | CLOSED | 20.000 | 20.000 | 0.000 | true | null | 2026-05-15T11:14:54.827Z |
| `cmp6tmxbc000cn7t3w64u5be3` | INV-00002 | FINAL | CLOSED | 230.000 | 255.000 | 0.000 | true | null | 2026-05-15T11:15:44.040Z |
| `cmp6tpi7y0013n7t3nh0fntxg` | ADJ-00003 | ADJUSTMENT | CLOSED | 45.000 | 45.000 | 0.000 | true | `cmp6tmxbc000cn7t3w64u5be3` | 2026-05-15T11:17:44.446Z |
| `cmp6trazg001fn7t32tzltzkv` | REF-00004 | REFUND | CLOSED | 45.000 | 45.000 | 0.000 | true | `cmp6tmxbc000cn7t3w64u5be3` | 2026-05-15T11:19:08.380Z |
| `cmp6trlgz001ln7t30z81e9bm` | CN-00005 | CREDIT_NOTE | CLOSED | 50.000 | 0.000 | 0.000 | true | `cmp6tmxbc000cn7t3w64u5be3` | 2026-05-15T11:19:21.971Z |

### Invoice Line Items

| invoice | lineType | description | qty | unit | total |
|---|---|---|---:|---:|---:|
| INV-00002 | PACKAGE_BASE | Basic Package | 1 | 150.000 | 150.000 |
| INV-00002 | EXTRA_PHOTOS | Extra photos - Print (Basic Package) | 5 | 3.000 | 15.000 |
| INV-00002 | ADD_ON | Album 30x30 | 1 | 65.000 | 65.000 |
| ADJ-00003 | ADD_ON | Album 20x20 | 1 | 45.000 | 45.000 |
| REF-00004 | MANUAL_DISCOUNT | QA refund for overpayment after paid adjustment removal | 1 | 45.000 | 45.000 |
| CN-00005 | MANUAL_DISCOUNT | QA manager goodwill credit | 1 | 50.000 | 50.000 |

### Payment Allocations

| invoice | paymentId | direction | paymentType | method | amount | allocatedAt |
|---|---|---|---|---|---:|---|
| DEP-00001 | `cmp6tlvcm0004n7t3xuyxrohr` | IN | DEPOSIT | KNET | 20.000 | 2026-05-15T11:14:54.840Z |
| INV-00002 | `cmp6tn7ii000jn7t3qlxiqksu` | IN | FINAL | KNET | 50.000 | 2026-05-15T11:15:57.260Z |
| INV-00002 | `cmp6tnqcn000nn7t3e71ureqy` | IN | FINAL | KNET | 140.000 | 2026-05-15T11:16:21.673Z |
| INV-00002 | `cmp6tophx000tn7t3dwfmsx5x` | IN | FINAL | KNET | 65.000 | 2026-05-15T11:17:07.223Z |
| ADJ-00003 | `cmp6tps9l0019n7t3481n2i1i` | IN | ADJUSTMENT | KNET | 45.000 | 2026-05-15T11:17:57.469Z |
| REF-00004 | `cmp6trazt001in7t34531d97l` | OUT | REFUND | CASH | 45.000 | 2026-05-15T11:19:08.394Z |

### Document Applications

| id | sourceDocId | targetDocId | amountApplied | appliedAt | notes |
|---|---|---|---:|---|---|
| `cmp6tmxbh000dn7t3kuge7x18` | `cmp6tlvcb0003n7t30b69mb8m` | `cmp6tmxbc000cn7t3w64u5be3` | 20.000 | 2026-05-15T11:15:44.045Z | Phase 1: deposit auto-application |
| `cmp6trlh3001nn7t3st9t74j2` | `cmp6trlgz001ln7t30z81e9bm` | `cmp6tmxbc000cn7t3w64u5be3` | 50.000 | 2026-05-15T11:19:21.969Z | Credit note for reason: QA manager credit note operational test |

## Order Activity Timeline

| createdAt | type | title | metadata |
|---|---|---|---|
| 2026-05-15T11:15:13.367Z | ORDER_CREATED | Order created | `{"bookingId":"cmp6tjsr00000n7t3phi482u3","jobNumber":"JOB-NB-2026-00001","packageId":"pkg-basic","packageLinePackageId":"pkg-basic"}` |
| 2026-05-15T11:15:44.052Z | ORDER_PACKAGE_EXTRAS_CHANGED | Package line photo selection updated | `{"orderPackageId":"cmp6tm9n40008n7t35h59mlv4","extraPhotoCount":5,"includedPhotoCount":20,"nextExtraPrintCount":5,"nextExtraDigitalCount":0,"nextSelectedPhotoCount":25,"previousExtraPrintCount":0,"previousExtraDigitalCount":0,"previousSelectedPhotoCount":20}` |
| 2026-05-15T11:15:44.054Z | INVOICE_ADJUSTED | Invoice created | `{"status":"Draft","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paidAmount":"0.000 KD","totalAmount":"165.000 KD","invoiceNumber":"INV-00002","remainingAmount":"145.000 KD","addOnAdjustmentAmount":"15.000","totalAdjustmentAmount":"15.000","packageAdjustmentAmount":"0.000"}` |
| 2026-05-15T11:15:44.145Z | ADD_ON_CHANGED | Add-on added | `{"price":"45.000","productId":"addon-album-20x20","productName":"Album 20x20","orderAddOnId":"cmp6tmxds000gn7t3mdtpab7n","addOnAdjustmentAmount":"45.000"}` |
| 2026-05-15T11:15:44.147Z | INVOICE_ADJUSTED | Invoice adjusted | `{"status":"Draft","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paidAmount":"0.000 KD","totalAmount":"210.000 KD","invoiceNumber":"INV-00002","remainingAmount":"190.000 KD","addOnAdjustmentAmount":"45.000","totalAdjustmentAmount":"45.000","packageAdjustmentAmount":"0.000"}` |
| 2026-05-15T11:15:57.268Z | PAYMENT_RECEIVED | Payment received | `{"amount":"50.000","method":"KNET","paidAt":"2026-05-15T11:15:00.000Z","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paymentId":"cmp6tn7ii000jn7t3qlxiqksu","reference":null,"paymentType":"FINAL","invoiceNumber":"INV-00002"}` |
| 2026-05-15T11:16:21.682Z | PAYMENT_RECEIVED | Payment received | `{"amount":"140.000","method":"KNET","paidAt":"2026-05-15T11:16:00.000Z","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paymentId":"cmp6tnqcn000nn7t3e71ureqy","reference":null,"paymentType":"FINAL","invoiceNumber":"INV-00002"}` |
| 2026-05-15T11:16:30.581Z | ADD_ON_CHANGED | Add-on added | `{"price":"65.000","productId":"addon-album-30x30","productName":"Album 30x30","orderAddOnId":"cmp6tnx7q000qn7t3ah6dd6bc","addOnAdjustmentAmount":"65.000"}` |
| 2026-05-15T11:16:30.582Z | INVOICE_ADJUSTED | Invoice adjusted | `{"status":"Draft","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paidAmount":"190.000 KD","totalAmount":"275.000 KD","invoiceNumber":"INV-00002","remainingAmount":"65.000 KD","addOnAdjustmentAmount":"65.000","totalAdjustmentAmount":"65.000","packageAdjustmentAmount":"0.000"}` |
| 2026-05-15T11:17:07.231Z | PAYMENT_RECEIVED | Payment received | `{"amount":"65.000","method":"KNET","paidAt":"2026-05-15T11:17:00.000Z","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paymentId":"cmp6tophx000tn7t3dwfmsx5x","reference":null,"paymentType":"FINAL","invoiceNumber":"INV-00002"}` |
| 2026-05-15T11:17:15.865Z | ADD_ON_CHANGED | Add-on removed | `{"price":"45.000","productId":"addon-album-20x20","productName":"Album 20x20","nextQuantity":0,"orderAddOnId":"cmp6tmxds000gn7t3mdtpab7n","previousQuantity":1,"addOnAdjustmentAmount":"-45.000"}` |
| 2026-05-15T11:17:15.866Z | INVOICE_ADJUSTED | Invoice adjusted | `{"status":"Draft","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paidAmount":"255.000 KD","totalAmount":"230.000 KD","invoiceNumber":"INV-00002","remainingAmount":"0.000 KD","addOnAdjustmentAmount":"-45.000","totalAdjustmentAmount":"-45.000","packageAdjustmentAmount":"0.000"}` |
| 2026-05-15T11:17:34.480Z | INVOICE_ADJUSTED | Invoice closed | `{"locked":true,"status":"CLOSED","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","invoiceNumber":"INV-00002"}` |
| 2026-05-15T11:17:44.450Z | INVOICE_ADJUSTED | Adjustment invoice created | `{"lineCount":1,"totalAmount":"45.000","notesPresent":true,"parentInvoiceId":"cmp6tmxbc000cn7t3w64u5be3","adjustmentInvoiceId":"cmp6tpi7y0013n7t3nh0fntxg"}` |
| 2026-05-15T11:17:44.458Z | INVOICE_ADJUSTED | Auto-adjustment issued | `{"lines":[{"quantity":1,"unitPrice":"45.000","description":"Album 20x20"}],"totalAmount":"45.000","parentInvoiceId":"cmp6tmxbc000cn7t3w64u5be3","adjustmentInvoiceId":"cmp6tpi7y0013n7t3nh0fntxg","adjustmentInvoiceNumber":"ADJ-00003","pairedCreditNoteInvoiceId":null,"pairedCreditNoteInvoiceNumber":null}` |
| 2026-05-15T11:17:44.459Z | ADD_ON_CHANGED | Add-on added | `{"price":"45.000","productId":"addon-album-20x20","productName":"Album 20x20","orderAddOnId":"cmp6tpi7l0012n7t3prj0w7ub","addOnAdjustmentAmount":"45.000"}` |
| 2026-05-15T11:17:57.481Z | PAYMENT_RECEIVED | Payment received | `{"amount":"45.000","method":"KNET","paidAt":"2026-05-15T11:17:00.000Z","invoiceId":"cmp6tpi7y0013n7t3nh0fntxg","paymentId":"cmp6tps9l0019n7t3481n2i1i","reference":null,"paymentType":"ADJUSTMENT","invoiceNumber":"ADJ-00003"}` |
| 2026-05-15T11:17:57.482Z | INVOICE_ADJUSTED | Adjustment settled | `{"locked":true,"status":"CLOSED","invoiceId":"cmp6tpi7y0013n7t3nh0fntxg","invoiceType":"ADJUSTMENT","invoiceNumber":"ADJ-00003"}` |
| 2026-05-15T11:18:05.847Z | ADD_ON_CHANGED | Add-on removed | `{"price":"45.000","productId":"addon-album-20x20","productName":"Album 20x20","nextQuantity":0,"orderAddOnId":"cmp6tpi7l0012n7t3prj0w7ub","previousQuantity":1,"addOnAdjustmentAmount":"-45.000"}` |
| 2026-05-15T11:18:05.848Z | INVOICE_ADJUSTED | Invoice adjusted | `{"status":"Closed","invoiceId":"cmp6tmxbc000cn7t3w64u5be3","paidAmount":"255.000 KD","totalAmount":"230.000 KD","invoiceNumber":"INV-00002","remainingAmount":"0.000 KD","addOnAdjustmentAmount":"-45.000","totalAdjustmentAmount":"-45.000","packageAdjustmentAmount":"0.000"}` |
| 2026-05-15T11:19:08.386Z | INVOICE_ADJUSTED | Refund invoice issued | `{"amount":"45.000","reason":"QA refund for overpayment after paid adjustment removal","refundInvoiceId":"cmp6trazg001fn7t32tzltzkv","sourceInvoiceId":"cmp6tmxbc000cn7t3w64u5be3","refundInvoiceNumber":"REF-00004","sourceInvoiceNumber":"INV-00002"}` |
| 2026-05-15T11:19:08.402Z | INVOICE_ADJUSTED | Refund payment recorded | `{"amount":"45.000","method":"CASH","refundInvoiceId":"cmp6trazg001fn7t32tzltzkv","refundPaymentId":"cmp6trazt001in7t34531d97l","refundOfPaymentId":"cmp6tophx000tn7t3dwfmsx5x","refundInvoiceNumber":"REF-00004"}` |
| 2026-05-15T11:19:22.038Z | INVOICE_ADJUSTED | Credit note issued | `{"amount":"50.000","reason":"QA manager credit note operational test","creditNoteId":"cmp6trlgz001ln7t30z81e9bm","targetInvoiceId":"cmp6tmxbc000cn7t3w64u5be3","creditNoteNumber":"CN-00005","targetInvoiceNumber":"INV-00002"}` |
| 2026-05-15T11:19:22.039Z | INVOICE_ADJUSTED | Refund available | `{"creditNoteId":"cmp6trlgz001ln7t30z81e9bm","overpaidAmount":"95.000","targetInvoiceId":"cmp6tmxbc000cn7t3w64u5be3","targetInvoiceNumber":"INV-00002"}` |

Later non-financial activities cover editing, production, and delivery completion and do not affect INV-18.
