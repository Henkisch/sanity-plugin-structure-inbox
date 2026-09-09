import {type ComponentType} from 'react'

/**
 * How much of the Home pane's width a widget asks for.
 *
 * The names mirror `@sanity/dashboard`'s `LayoutSize` so a widget written for
 * one surface can move to the other without a rewrite.
 *
 * @public
 */
export type WidgetWidth = 'small' | 'medium' | 'large' | 'full'

/**
 * Props every widget receives.
 *
 * @public
 */
export interface StructureHomeWidgetProps {
  /** The widget's own `name`, useful for keying persisted state. */
  name: string
}

/**
 * A single block of content on the Home pane.
 *
 * Shaped after `@sanity/dashboard`'s `DashboardWidget` on purpose: the same
 * widget should be droppable into either surface once both plugins have proven
 * themselves. Widgets are produced by factory functions — `recentlyEdited()`,
 * `quickCreate()` — rather than written as object literals, so their options
 * are typed at the call site.
 *
 * @public
 */
export interface StructureHomeWidget {
  /** Stable identifier. Used as a React key and as the key for persisted editor preferences. */
  name: string
  /** Rendered inside the widget card. Must not draw its own outer card. */
  component: ComponentType<StructureHomeWidgetProps>
  /** Heading shown in the widget card's header. Omit for a card with no header. */
  title?: string
  /** Icon shown next to the title. */
  icon?: ComponentType
  /** Layout hints. `width` maps onto the Home pane's grid. */
  layout?: {width?: WidgetWidth}
}

/**
 * Options for {@link structureHome}.
 *
 * @public
 */
export interface StructureHomeConfig {
  /**
   * Which structure tool to attach to. Defaults to `structure`, the name
   * `structureTool()` uses unless given one. Set this when the Studio runs
   * several structure tools and only one should have a Home pane.
   */
  toolName?: string

  /**
   * Widgets to render, in order.
   */
  widgets?: StructureHomeWidget[]

  /**
   * Title shown on the Home pane and on its item in the root list.
   * Defaults to the localized `home.title`.
   */
  title?: string

  /**
   * Whether to add the Home item to the root list automatically.
   *
   * Leave this on unless you place {@link homeListItem} in your own structure.
   * Turning it off does not disable the pane — only the automatic injection.
   *
   * @defaultValue true
   */
  autoInject?: boolean

  /**
   * Whether to send editors to the Home pane when they land on the tool with
   * nothing selected. Turning this off leaves the Home item in the list as
   * something the editor opens themselves.
   *
   * @defaultValue true
   */
  redirectOnLanding?: boolean
}

/** @internal */
export type ResolvedStructureHomeConfig = Required<
  Pick<StructureHomeConfig, 'toolName' | 'autoInject' | 'redirectOnLanding' | 'widgets'>
> &
  Pick<StructureHomeConfig, 'title'>
