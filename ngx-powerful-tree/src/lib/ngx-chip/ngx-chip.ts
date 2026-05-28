import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'ngx-chip',
  standalone: true,
  imports: [TooltipModule],
  templateUrl: './ngx-chip.html',
  styleUrl: './ngx-chip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NgxChipComponent {
  label = input.required<string>();
  selected = model<boolean>(false);
  tooltip = input<string>('');
  shareButtonTooltip = input<string>('Share');

  shareClick = output<MouseEvent>();
  deleteClick = output<MouseEvent>();

  tooltipText = computed(() => this.tooltip() || this.label());

  onChipClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('button')) return;
    this.selected.update((v) => !v);
  }

  onShareClick(event: MouseEvent): void {
    event.stopPropagation();
    this.shareClick.emit(event);
  }

  onDeleteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.deleteClick.emit(event);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selected.update((v) => !v);
    }
  }
}
