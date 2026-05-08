function Icon(props: { name: string; label: string; children: unknown }) {
  return (
    <svg class="icon" data-icon={props.name} aria-label={props.label} role="img" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {props.children}
    </svg>
  );
}

export function IconPencil() {
  return <Icon name="IconPencil" label="编辑"><path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4" /><path d="M13.5 6.5l4 4" /></Icon>;
}

export function IconPlus() {
  return <Icon name="IconPlus" label="新会话"><path d="M12 5v14" /><path d="M5 12h14" /></Icon>;
}

export function IconSettings() {
  return <Icon name="IconSettings" label="设置"><path d="M10.3 4.3l.4-1.3h2.6l.4 1.3a2 2 0 0 0 2.4 1.3l1.3-.4 1.3 2.2-1 1a2 2 0 0 0 0 2.8l1 1-1.3 2.2-1.3-.4a2 2 0 0 0-2.4 1.3l-.4 1.3h-2.6l-.4-1.3A2 2 0 0 0 8 14l-1.3.4-1.3-2.2 1-1a2 2 0 0 0 0-2.8l-1-1 1.3-2.2 1.3.4a2 2 0 0 0 2.4-1.3" /><circle cx="12" cy="12" r="3" /></Icon>;
}

export function IconArrowUp() {
  return <Icon name="IconArrowUp" label="发送"><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></Icon>;
}

export function IconArrowLeft() {
  return <Icon name="IconArrowLeft" label="返回"><path d="M5 12h14" /><path d="M5 12l6 6" /><path d="M5 12l6-6" /></Icon>;
}

export function IconMoon() {
  return <Icon name="IconMoon" label="深色"><path d="M12 3a6.5 6.5 0 1 0 8.7 8.7A8 8 0 1 1 12 3" /></Icon>;
}

export function IconSun() {
  return <Icon name="IconSun" label="浅色"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.9 4.9l1.4 1.4" /><path d="M17.7 17.7l1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="M4.9 19.1l1.4-1.4" /><path d="M17.7 6.3l1.4-1.4" /></Icon>;
}

export function IconLayoutSidebarLeftCollapse() {
  return <Icon name="IconLayoutSidebarLeftCollapse" label="收起侧栏"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M16 10l-2 2 2 2" /></Icon>;
}

export function IconLayoutSidebarLeftExpand() {
  return <Icon name="IconLayoutSidebarLeftExpand" label="展开侧栏"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="M14 10l2 2-2 2" /></Icon>;
}
