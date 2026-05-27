import {
  Directive,
  ElementRef,
  EmbeddedViewRef,
  TemplateRef,
  inject,
  input,
  NgZone,
  OnInit,
  DestroyRef,
  PLATFORM_ID,
  ApplicationRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const TRANSPARENT_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

@Directive({
  selector: '[ngxTreeDragPreview]',
  standalone: true,
})
export class NgxTreeDragPreviewDirective<T = unknown> implements OnInit {
  private el = inject(ElementRef);
  private appRef = inject(ApplicationRef);
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);

  ngxTreeDragPreview = input.required<TemplateRef<T>>();
  ngxTreeDragPreviewContext = input.required<T>();

  private viewRef: EmbeddedViewRef<T> | null = null;
  private previewElement: HTMLElement | null = null;
  private dragOverListener: ((e: DragEvent) => void) | null = null;

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.ngZone.runOutsideAngular(() => {
      const nativeEl = this.el.nativeElement as HTMLElement;

      const onDragStart = (e: DragEvent) => this.handleDragStart(e);
      const onDragEnd = () => this.handleDragEnd();

      nativeEl.addEventListener('dragstart', onDragStart);
      nativeEl.addEventListener('dragend', onDragEnd);

      this.destroyRef.onDestroy(() => {
        nativeEl.removeEventListener('dragstart', onDragStart);
        nativeEl.removeEventListener('dragend', onDragEnd);
        this.cleanup();
      });
    });
  }

  private handleDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;

    // 1. Bypass native opacity
    const img = new Image();
    img.src = TRANSPARENT_GIF;
    e.dataTransfer.setDragImage(img, 0, 0);

    // 2. Instantiate template (we do this inside ngZone to ensure bindings are evaluated correctly)
    this.ngZone.run(() => {
      this.viewRef = this.ngxTreeDragPreview().createEmbeddedView(this.ngxTreeDragPreviewContext());
      this.appRef.attachView(this.viewRef);
      this.viewRef.detectChanges();
    });

    // We expect the template to have a single root element (or we take the first HTMLElement)
    if (!this.viewRef) return;
    this.previewElement = this.viewRef.rootNodes.find(
      (node) => node.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement;

    if (this.previewElement) {
      // 3. Apply styles
      Object.assign(this.previewElement.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '99999',
        willChange: 'transform',
        top: '0',
        left: '0',
        margin: '0',
        transform: `translate3d(${e.clientX + 15}px, ${e.clientY + 15}px, 0)`,
      });

      document.body.appendChild(this.previewElement);

      // 4. Listen to dragover for updates (outside Angular)
      this.dragOverListener = (dragEvent: DragEvent) => {
        if (this.previewElement) {
          const x = dragEvent.clientX + 15;
          const y = dragEvent.clientY + 15;
          this.previewElement.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
      };
      document.addEventListener('dragover', this.dragOverListener);
    }
  }

  private handleDragEnd() {
    this.cleanup();
  }

  private cleanup() {
    if (this.dragOverListener) {
      document.removeEventListener('dragover', this.dragOverListener);
      this.dragOverListener = null;
    }
    if (this.previewElement) {
      if (this.previewElement.parentNode) {
        this.previewElement.parentNode.removeChild(this.previewElement);
      }
      this.previewElement = null;
    }
    if (this.viewRef) {
      this.appRef.detachView(this.viewRef);
      this.viewRef.destroy();
      this.viewRef = null;
    }
  }
}
