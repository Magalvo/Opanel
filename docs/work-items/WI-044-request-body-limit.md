# WI-044 — Request body size limit

- Status: Proposed (awaiting owner approval)
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (found in the audit of 2026-11-14,
  finding A-03; the code it touches was built in WT-01)
- Depends on: none
- Work-spec: [WS-044](../work-specs/WS-044-request-body-limit.md)

## Outcome

A JSON request body larger than a fixed budget is refused with `413 payload_too_large`
before it is parsed or validated, and before any service runs. Today `readJson` loads the
whole body into memory; the field length limits in the Zod schemas only apply afterwards.

## Acceptance criteria

- [ ] A body over the budget is answered `413` with the problem body, whether the request
      declares its length, declares a wrong one, or declares none.
- [ ] Reading stops once the budget is exceeded; the rest of the body is not buffered.
- [ ] A body at exactly the budget is still processed as before.
- [ ] The budget counts bytes, not characters.
- [ ] Every operation that accepts a JSON body documents `413` in its contract and in the
      generated OpenAPI document.
- [ ] A test against the running server (not only a constructed `Request`) proves it.
- [ ] Canonical doc 0004 lists the status and the code.
- [ ] The full quality gate passes.

## Notes

Reverse-proxy limits for production belong to the production-deployment follow-up and are
recorded there.
