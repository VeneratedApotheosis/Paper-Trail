import type { BodySource } from "../mime";

/**
 * Realistic SYNTHETIC HTML receipt emails for the email-to-text tests (issue #116): fictional stores on .example domains,
 * fake customer Sam Rivera, 555-01xx phone numbers. Built like real marketing/transactional mail: nested layout tables,
 * hidden preheaders, tracking pixels, thin text/plain parts, footers.
 */
export interface HtmlReceiptFixture {
  name: string;
  from: string;
  subject: string;
  /** text/plain part; `null` = HTML-only message. */
  plain: string | null;
  html: string;
  expectedSource: BodySource;
  /** Lines that must appear verbatim in the converted text. */
  mustContain: string[];
  /** Substrings that must not leak into the converted text. */
  mustNotContain: string[];
}

const PREHEADER_PADDING = "&#847;&zwnj;&nbsp;".repeat(40);

const wrap = (preheader: string, body: string, footer: string) => `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>Receipt</title><style type="text/css">body{margin:0}.btn{background:#222;color:#fff}@media only screen{.w{width:100%}}</style></head>
<body style="margin:0;padding:0;background:#f4f4f4">
<span class="preheader" style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;mso-hide:all">${preheader}${PREHEADER_PADDING}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4"><tr><td align="center">
<!--[if mso]><table width="600"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td style="padding:24px">
${body}
</td></tr><tr><td style="padding:16px;background:#eeeeee;font-size:11px">
${footer}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
<img src="https://track.example/o/9f3a1c7e2b4d6a8c0e1f3a5b7c9d1e2f3a4b5c6d7e8f9a0b.gif" width="1" height="1" alt="" style="display:block" />
</body></html>`;

const FOOTER = `<p style="margin:0">Questions? Call <a href="tel:5550102299">(555) 010-2299</a> or reply to this email.</p>
<p style="margin:8px 0 0"><a href="https://shop.example/unsubscribe?u=c2FtLnJpdmVyYUBtYWlsLmV4YW1wbGU&amp;t=8f2a91c3d4e5f60718293a4b5c6d7e8f">Unsubscribe</a> | <a href="https://shop.example/prefs?u=c2FtLnJpdmVyYUBtYWlsLmV4YW1wbGU">Manage preferences</a></p>
<p style="margin:8px 0 0">&copy; 2026 Fictional Retail Co. All rights reserved.</p>`;

const itemRow = (name: string, detail: string, qty: number, price: string) =>
  `<tr><td width="64" style="padding:8px 0"><img src="https://img.shop.example/p/${encodeURIComponent(name)}.jpg" width="56" height="56" alt="${name}" /></td>
<td style="padding:8px"><strong>${name}</strong><br /><span style="color:#777">${detail}</span></td>
<td align="center" style="padding:8px">Qty ${qty}</td><td align="right" style="padding:8px">${price}</td></tr>`;

const totalRow = (label: string, value: string, bold = false) =>
  `<tr><td colspan="2"></td><td align="right" style="padding:4px 8px">${bold ? `<b>${label}</b>` : label}</td><td align="right" style="padding:4px 8px">${bold ? `<b>${value}</b>` : value}</td></tr>`;

export const HTML_RECEIPT_FIXTURES: HtmlReceiptFixture[] = [
  {
    name: "order confirmation with a browser-link-only plain part",
    from: '"Fernhill Outfitters" <orders@fernhill-outfitters.example>',
    subject: "Order confirmed: FH-48213",
    plain: "Your order is confirmed. View this email in your browser: https://email.fernhill-outfitters.example/v/8a7f6e5d4c3b2a19080706050403020100ffeeddccbbaa99887766554433221100",
    html: wrap(
      "Thanks, Sam! Your order FH-48213 is confirmed.",
      `<h1 style="font-size:22px">Thanks for your order, Sam!</h1>
<p>Order number: <strong>FH-48213</strong><br />Placed on October 3, 2026</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0">
${itemRow("Ridgeline Rain Shell", "Size M / Moss", 1, "$89.00")}
${itemRow("Merino Trail Socks (3-pack)", "Size L", 2, "$36.00")}
<tr><td colspan="4"><hr /></td></tr>
${totalRow("Subtotal", "$125.00")}
${totalRow("Shipping", "$0.00")}
${totalRow("Tax", "$9.45")}
${totalRow("Order total", "$134.45", true)}
</table>
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top" width="50%"><h3>Ship to</h3><p>Sam Rivera<br />412 Alder Street<br />Portland, OR 97205</p></td>
<td valign="top" width="50%"><h3>Payment</h3><p>Visa ending in 4242</p></td></tr></table>
<p>Return window: 30 days from delivery. <a href="https://fernhill-outfitters.example/returns?order=FH-48213&amp;token=7d8e9f0a1b2c3d4e5f60718293a4b5c6">Start a return</a></p>`,
      FOOTER,
    ),
    expectedSource: "html",
    mustContain: [
      "Order number: FH-48213",
      "Ridgeline Rain Shell, Size M / Moss | Qty 1 | $89.00",
      "Subtotal | $125.00",
      "Tax | $9.45",
      "Order total | $134.45",
      "Return window: 30 days from delivery. Start a return",
      "Visa ending in 4242",
    ],
    mustNotContain: ["track.example", "token=", "padding", "Receipt", "mso", "&zwnj;", "All rights reserved"],
  },
  {
    name: "order confirmation whose plain part is complete",
    from: '"Brightside Electronics" <orders@brightside-electronics.example>',
    subject: "Your Brightside order BE-7731 has been placed",
    plain: `Hi Sam,

Thanks for shopping with Brightside Electronics. Here is your order summary.

Order BE-7731 - placed October 4, 2026

1 x Aurora Desk Lamp ........ $48.00
1 x USB-C Charging Dock ..... $62.50

Subtotal: $110.50
Shipping: $5.99
Tax: $9.28
Order total: $125.77

Paid with Visa ending in 4242.
You can return unused items within 30 days of delivery.

Questions? Call (555) 010-4410.`,
    html: wrap(
      "Your Brightside order BE-7731 is confirmed",
      `<h2>Order BE-7731</h2><p>Hi Sam, thanks for shopping with Brightside Electronics.</p>
<table width="100%">
<tr><td>Aurora Desk Lamp x 1</td><td align="right">$48.00</td></tr>
<tr><td>USB-C Charging Dock x 1</td><td align="right">$62.50</td></tr>
<tr><td>Subtotal</td><td align="right">$110.50</td></tr>
<tr><td>Shipping</td><td align="right">$5.99</td></tr>
<tr><td>Tax</td><td align="right">$9.28</td></tr>
<tr><td><b>Order total</b></td><td align="right"><b>$125.77</b></td></tr></table>
<p>Paid with Visa ending in 4242. You can return unused items within 30 days of delivery.</p>`,
      FOOTER,
    ),
    expectedSource: "plain",
    mustContain: ["Order total: $125.77", "1 x USB-C Charging Dock ..... $62.50", "Order BE-7731 - placed October 4, 2026"],
    mustNotContain: ["Unsubscribe"],
  },
  {
    name: "refund issued email with a thin plain part",
    from: '"Pinecrest Home" <care@pinecrest-home.example>',
    subject: "Your refund is on its way",
    plain: "Your refund has been issued. Can't see this email? View it in your browser.",
    html: wrap(
      "We've refunded $64.99 to your Visa ending in 4242.",
      `<h1>Your refund has been issued</h1>
<p>Hi Sam, we received your return for order <strong>PH-90412</strong> and issued a refund.</p>
<table width="100%" cellpadding="6">
<tr><td>Cedar Storage Bench</td><td align="right">$79.99</td></tr>
<tr><td>Restocking fee</td><td align="right">-$15.00</td></tr>
<tr><td><b>Refund total</b></td><td align="right"><b>$64.99</b></td></tr></table>
<p>Refund issued October 12, 2026 to Visa ending in 4242. Banks usually post refunds within 5-10 business days.</p>`,
      FOOTER,
    ),
    expectedSource: "html",
    mustContain: [
      "Hi Sam, we received your return for order PH-90412 and issued a refund.",
      "Cedar Storage Bench | $79.99",
      "Restocking fee | -$15.00",
      "Refund total | $64.99",
    ],
    mustNotContain: ["display:none", "track.example"],
  },
  {
    name: "shipping notification with a boilerplate plain part",
    from: '"Voltline Gear" <shipping@voltline-gear.example>',
    subject: "Your order VG-20871 has shipped",
    plain: "Your Voltline order has shipped! If you are having trouble viewing this message, view it online: https://voltline-gear.example/e/shipped/77aa88bb99cc",
    html: wrap(
      "Package on the way: track it with UPS 1Z999AA10123456784",
      `<h2>Your order has shipped</h2>
<table width="100%"><tr><td>Order</td><td>VG-20871</td></tr>
<tr><td>Carrier</td><td>UPS Ground</td></tr>
<tr><td>Tracking number</td><td><a href="https://wwwapps.ups.example/track?tracknum=1Z999AA10123456784&amp;loc=en_US">1Z999AA10123456784</a></td></tr>
<tr><td>Estimated delivery</td><td>October 9, 2026</td></tr></table>
<h3>In this shipment</h3>
<ul><li>Trailhead Headlamp x 1</li><li>Lithium AAA Batteries (8-pack) x 1</li></ul>`,
      FOOTER,
    ),
    expectedSource: "html",
    mustContain: ["Order | VG-20871", "Carrier | UPS Ground", "Tracking number | 1Z999AA10123456784", "Estimated delivery | October 9, 2026", "- Trailhead Headlamp x 1"],
    mustNotContain: ["wwwapps.ups.example", "tracknum="],
  },
  {
    name: "HTML-only order with Outlook conditional comments and euro prices",
    from: '"Maple & Moss Books" <hello@maple-moss-books.example>',
    subject: "Bestellbestätigung MM-55102 / Order MM-55102",
    plain: null,
    html: wrap(
      "Your books are being packed.",
      `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->
<table width="100%" border="0"><tr><td>
<font face="Georgia" size="4">Order MM-55102</font>
<table width="100%" border="0">
<tr><td>The Quiet Orchard (hardcover)</td><td align="right">&euro;24,90</td></tr>
<tr><td>Field Notes for Slow Mornings</td><td align="right">&euro;18,50</td></tr>
<tr><td>Subtotal</td><td align="right">&euro;43,40</td></tr>
<tr><td>Shipping</td><td align="right">&euro;3,90</td></tr>
<tr><td><b>Order total</b></td><td align="right"><b>&euro;47,30</b></td></tr>
</table></td></tr></table>`,
      FOOTER,
    ),
    expectedSource: "html",
    mustContain: ["Order MM-55102", "The Quiet Orchard (hardcover) | €24,90", "Order total | €47,30"],
    mustNotContain: ["o:AllowPNG", "[endif]", "&euro;"],
  },
  {
    name: "order with a near-empty plain part and an image-heavy HTML body",
    from: '"Cobalt Cycles" <orders@cobalt-cycles.example>',
    subject: "Receipt for order CC-3318",
    plain: "Receipt attached below.\n\n--\nCobalt Cycles",
    html: wrap(
      "Receipt for order CC-3318",
      `<img src="https://cdn.cobalt-cycles.example/logo.png" alt="Cobalt Cycles logo" width="180" height="40" />
<img src="https://cdn.cobalt-cycles.example/hero.jpg" alt="" width="600" height="200" />
<h2>Receipt</h2>
<p>Order <b>CC-3318</b> &bull; October 6, 2026</p>
<table width="100%"><tr><th align="left">Item</th><th>Qty</th><th align="right">Price</th></tr>
<tr><td>Gravel Tire 700x40 (pair)</td><td>1</td><td align="right">$72.00</td></tr>
<tr><td>Frame Bag, Large</td><td>1</td><td align="right">$54.00</td></tr>
<tr><td>Tax</td><td></td><td align="right">$10.08</td></tr>
<tr><td>Order total</td><td></td><td align="right">$136.08</td></tr></table>
<p style="display:none">Hidden promo: save $20 on your next order with code NEXT20</p>`,
      FOOTER,
    ),
    expectedSource: "html",
    mustContain: ["Order CC-3318 • October 6, 2026", "Item | Qty | Price", "Gravel Tire 700x40 (pair) | 1 | $72.00", "Tax | $10.08", "Order total | $136.08"],
    mustNotContain: ["Cobalt Cycles logo", "NEXT20", "hero.jpg"],
  },
];
