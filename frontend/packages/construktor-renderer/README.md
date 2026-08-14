# @construktor/renderer

Versioned public renderer for normalized Construktor documents and backend
`PageDocument` block trees.

```jsx
import {
  ConstruktorRenderer,
  createIntegrationAdapters,
} from '@construktor/renderer';

const adapters = createIntegrationAdapters({
  apiBaseUrl: '/api/v1',
  basePath: '/',
});

<ConstruktorRenderer
  document={page}
  {...adapters}
  integrationSlots={{
    search: SearchIntegration,
  }}
/>;
```

The renderer accepts `document`, `assetResolver`, `formSubmitter`,
`linkResolver`, and `integrationSlots`. Adapter types and safe defaults are
exported from the package root. A block can request a slot with
`props.integrationSlot`; set `props.required` or `props.integrationRequired`
to report a visible renderer error when the host does not provide it.

Importing the package root loads the scoped stylesheet. It is also exported as
`@construktor/renderer/styles.css` for hosts that manage CSS explicitly.
