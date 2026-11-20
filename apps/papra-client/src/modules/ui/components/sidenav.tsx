import type { Component, ComponentProps, JSX } from 'solid-js';
import { A } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { cn } from '@/modules/shared/style/cn';
import { Button } from './button';
import { getMoveByOffsetTarget } from './sidenav.models';
import type { DropPlacement } from './sidenav.models';

export type SideNavMenuItem = {
  // Identifies the item for drag & drop reordering, only used when its section has `onReorder`
  id?: string;
  label: string;
  icon: string;
  // Replaces the icon when provided, e.g. a colored dot
  leading?: JSX.Element;
  href?: string;
  onClick?: () => void;
  badge?: JSX.Element;
};

export type SideNavSection = {
  label?: string;
  action?: JSX.Element;
  // Enables reordering of the items having an `id` (drag & drop, Alt+ArrowUp/ArrowDown)
  onReorder?: (args: { id: string; targetId: string; placement: DropPlacement }) => void;
  items: SideNavMenuItem[];
};

const MenuItemButton: Component<SideNavMenuItem & { draggable?: boolean }> = (props) => {
  return (
    <Button
      class="justify-start items-center gap-2 dark:text-muted-foreground truncate"
      variant="ghost"
      draggable={props.draggable}
      {...(props.onClick
        ? { onClick: props.onClick }
        : ({
            as: A,
            href: props.href,
            activeClass: 'bg-accent/50! text-accent-foreground! truncate',
            end: true,
          } as ComponentProps<typeof Button>))}
    >
      {props.leading ?? (
        <div class={cn(props.icon, 'size-5 text-muted-foreground opacity-50 flex-shrink-0')} />
      )}
      <div class="truncate">{props.label}</div>
      {props.badge && <div class="ml-auto">{props.badge}</div>}
    </Button>
  );
};

const ReorderableMenuItem: Component<{
  item: SideNavMenuItem;
  ids: string[];
  onReorder: NonNullable<SideNavSection['onReorder']>;
  getDraggedId: () => string | undefined;
  setDraggedId: (id: string | undefined) => void;
}> = (props) => {
  const [getPlacement, setPlacement] = createSignal<DropPlacement>();
  const id = () => props.item.id as string;
  const [getContainer, setContainer] = createSignal<HTMLDivElement>();

  const getDropPlacement = (event: DragEvent): DropPlacement => {
    const rect = getContainer()!.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  const isDropTarget = () => props.getDraggedId() !== undefined && props.getDraggedId() !== id();

  return (
    <div
      ref={setContainer}
      class="relative"
      draggable="true"
      data-reorderable-id={id()}
      onDragStart={(event) => {
        event.dataTransfer?.setData('text/plain', id());
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
        }
        props.setDraggedId(id());
      }}
      onDragEnd={() => {
        props.setDraggedId(undefined);
        setPlacement(undefined);
      }}
      onDragOver={(event) => {
        if (!isDropTarget()) {
          return;
        }
        // Allows dropping and prevents the browser from navigating to the dragged link
        event.preventDefault();
        setPlacement(getDropPlacement(event));
      }}
      onDragLeave={(event) => {
        if (!getContainer()?.contains(event.relatedTarget as Node | null)) {
          setPlacement(undefined);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const draggedId = props.getDraggedId();
        const placement = getDropPlacement(event);
        setPlacement(undefined);
        props.setDraggedId(undefined);

        if (draggedId !== undefined && draggedId !== id()) {
          props.onReorder({ id: draggedId, targetId: id(), placement });
        }
      }}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
          return;
        }

        event.preventDefault();
        const target = getMoveByOffsetTarget({
          ids: props.ids,
          id: id(),
          offset: event.key === 'ArrowUp' ? -1 : 1,
        });

        if (target) {
          props.onReorder({ id: id(), ...target });
          // The items are re-created on reorder, so restore the focus on the moved one
          setTimeout(() => {
            document
              .querySelector<HTMLElement>(`[data-reorderable-id="${CSS.escape(id())}"] a`)
              ?.focus();
          });
        }
      }}
    >
      <Show when={isDropTarget() && getPlacement()}>
        {(getValue) => (
          <div
            class={cn(
              'absolute inset-x-0 h-0.5 rounded-full bg-primary pointer-events-none z-10',
              getValue() === 'before' ? '-top-px' : '-bottom-px',
            )}
          />
        )}
      </Show>
      <MenuItemButton {...props.item} draggable={false} />
    </div>
  );
};

const SideNavSectionItems: Component<{ section: SideNavSection }> = (props) => {
  const [getDraggedId, setDraggedId] = createSignal<string>();
  const getIds = () => props.section.items.flatMap((item) => (item.id ? [item.id] : []));

  return (
    <For each={props.section.items}>
      {(menuItem) => (
        <Show
          when={props.section.onReorder && menuItem.id}
          fallback={<MenuItemButton {...menuItem} />}
        >
          <ReorderableMenuItem
            item={menuItem}
            ids={getIds()}
            onReorder={props.section.onReorder!}
            getDraggedId={getDraggedId}
            setDraggedId={setDraggedId}
          />
        </Show>
      )}
    </For>
  );
};

export const SideNav: Component<{
  mainMenu: SideNavSection[];
  footerMenu?: SideNavMenuItem[];
  header?: Component;
  footer?: Component;
  preFooter?: Component;
}> = (props) => {
  return (
    <div class="flex h-full">
      {(props.header || props.mainMenu || props.footerMenu || props.footer || props.preFooter) && (
        <div class="h-full flex flex-col pb-6 flex-1 min-w-0">
          {props.header && <props.header />}

          <For each={props.mainMenu}>
            {(section) => (
              <div class="mt-4 px-4">
                {section.label && (
                  <div class="flex items-center justify-between pl-3 mb-2">
                    <div class="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                      {section.label}
                    </div>
                    {section.action}
                  </div>
                )}
                <nav class="flex flex-col gap-0.5">
                  <SideNavSectionItems section={section} />
                </nav>
              </div>
            )}
          </For>

          <div class="flex-1" />

          {props.preFooter && <props.preFooter />}

          {props.footerMenu && (
            <nav class="flex flex-col gap-0.5 px-4">
              <For each={props.footerMenu}>{(menuItem) => <MenuItemButton {...menuItem} />}</For>
            </nav>
          )}

          {props.footer && <props.footer />}
        </div>
      )}
    </div>
  );
};
