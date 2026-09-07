# Tickets replace Cards, product-wide, with a fresh start

Triathlon calls its unit of work a Ticket everywhere: in the domain, public HTTP interface, generated clients, CLI, UI, storage, and documentation. V2 does not preserve Card aliases or migrate existing Convex data. A complete fresh start is acceptable while the product has no external compatibility obligations, and prevents the legacy term or storage shape from leaking into the new backend.
