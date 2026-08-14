import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useBuilderStore } from '../store/builderStore.js';

export default function InlineRichText({ block, selected }) {
  const updateBlock = useBuilderStore((state) => state.updateBlock);
  const timer = useRef(null);
  const latest = useRef(block.props.html);
  const editor = useEditor({
    extensions: [StarterKit],
    content: block.props.html,
    editorProps: {
      attributes: {
        class: 'pb-inline-richtext__content',
        'aria-label': 'Форматированный текст',
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      latest.current = nextEditor.getHTML();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        updateBlock(block.id, { html: latest.current });
      }, 350);
    },
  });

  useEffect(() => () => {
    clearTimeout(timer.current);
    if (latest.current !== block.props.html) updateBlock(block.id, { html: latest.current });
  }, [block.id, block.props.html, updateBlock]);

  useEffect(() => {
    if (editor && block.props.html !== editor.getHTML() && block.props.html !== latest.current) {
      latest.current = block.props.html;
      editor.commands.setContent(block.props.html, { emitUpdate: false });
    }
  }, [block.props.html, editor]);

  if (!editor) return null;
  return (
    <div className={`pb-inline-richtext pb-align--${block.props.align || 'left'}`}>
      {selected && (
        <div className="pb-inline-richtext__toolbar" role="toolbar" aria-label="Форматирование текста">
          <button type="button" className={editor.isActive('bold') ? 'is-active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Полужирный"><strong>Ж</strong></button>
          <button type="button" className={editor.isActive('italic') ? 'is-active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Курсив"><em>К</em></button>
          <button type="button" className={editor.isActive('bulletList') ? 'is-active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Маркированный список">• Список</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().undo().run()} aria-label="Отменить изменение текста">↶</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().redo().run()} aria-label="Повторить изменение текста">↷</button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
