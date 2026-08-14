import { useEffect, useMemo, useState } from 'react';
import { api, isDemoMode } from '../api/client.js';
import { BACKEND_BLOCK_TYPES } from '../api/adapters.js';
import { useSession } from '../auth/SessionContext.jsx';
import { getBlockDefinition, registryByCategory } from '../registry/index.js';
import { useBuilderStore } from '../store/builderStore.js';

function OutlineNode({ id, depth = 0 }) {
  const block = useBuilderStore((state) => state.byId[id]);
  const children = useBuilderStore((state) => state.childrenByParent[id] || []);
  const selected = useBuilderStore((state) => state.selectedId === id);
  const selectBlock = useBuilderStore((state) => state.selectBlock);
  if (!block) return null;
  const definition = getBlockDefinition(block.type);
  return (
    <li>
      <button
        type="button"
        className={selected ? 'is-selected' : undefined}
        style={{ '--pb-tree-depth': depth }}
        onClick={() => selectBlock(id)}
      >
        <span aria-hidden="true">{definition?.icon || '□'}</span>
        <span>{definition?.label || block.type}</span>
      </button>
      {children.length > 0 && (
        <ul>{children.map((childId) => <OutlineNode id={childId} depth={depth + 1} key={childId} />)}</ul>
      )}
    </li>
  );
}

export default function BlockLibrary() {
  const [tab, setTab] = useState('blocks');
  const [query, setQuery] = useState('');
  const { user } = useSession();
  const [serverTypes, setServerTypes] = useState(BACKEND_BLOCK_TYPES);
  const selectedId = useBuilderStore((state) => state.selectedId);
  const selected = useBuilderStore((state) => state.byId[state.selectedId]);
  const rootOrder = useBuilderStore((state) => state.rootOrder);
  const addBlock = useBuilderStore((state) => state.addBlock);
  useEffect(() => {
    if (isDemoMode) return;
    api.registry.get()
      .then((manifest) => setServerTypes(new Set((manifest.blocks || []).map((block) => block.type))))
      .catch(() => setServerTypes(new Set()));
  }, []);
  const categories = useMemo(() => {
    const groups = registryByCategory();
    return Object.fromEntries(Object.entries(groups).map(([category, definitions]) => [
      category,
      definitions.filter((item) => (
        isDemoMode
        || (serverTypes.has(item.type) && (item.type !== 'html' || user?.role === 'Admin'))
      )),
    ]));
  }, [serverTypes, user?.role]);

  const add = (type) => {
    const definition = selected && getBlockDefinition(selected.type);
    addBlock(type, definition?.acceptsChildren ? selectedId : null);
  };

  return (
    <aside className="pb-editor-left" aria-label="Инструменты конструктора">
      <div className="pb-editor-tabs" role="tablist" aria-label="Левая панель">
        <button type="button" role="tab" aria-selected={tab === 'blocks'} onClick={() => setTab('blocks')}>Блоки</button>
        <button type="button" role="tab" aria-selected={tab === 'outline'} onClick={() => setTab('outline')}>Структура</button>
      </div>
      {tab === 'blocks' ? (
        <div className="pb-block-library">
          <label className="pb-search pb-search--small">
            <span aria-hidden="true">⌕</span>
            <span className="pb-visually-hidden">Поиск блоков</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти блок…" />
          </label>
          <div className="pb-block-library__groups">
            {Object.entries(categories).map(([category, definitions]) => {
              const filtered = definitions.filter((item) => (
                `${item.label} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase())
              ));
              if (!filtered.length) return null;
              return (
                <section key={category}>
                  <h2>{category}</h2>
                  <div>
                    {filtered.map((item) => (
                      <button type="button" key={item.type} onClick={() => add(item.type)} title={item.description || item.label}>
                        <span aria-hidden="true">{item.icon}</span>
                        <strong>{item.label}</strong>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="pb-outline">
          {rootOrder.length ? <ul>{rootOrder.map((id) => <OutlineNode id={id} key={id} />)}</ul> : (
            <p>Добавьте блок, чтобы сформировать структуру.</p>
          )}
        </div>
      )}
    </aside>
  );
}
