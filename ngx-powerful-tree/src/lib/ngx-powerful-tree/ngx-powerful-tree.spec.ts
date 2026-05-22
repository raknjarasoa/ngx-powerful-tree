import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgxPowerfulTree } from './ngx-powerful-tree';

describe('NgxPowerfulTree', () => {
  let component: NgxPowerfulTree;
  let fixture: ComponentFixture<NgxPowerfulTree>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NgxPowerfulTree],
    }).compileComponents();

    fixture = TestBed.createComponent(NgxPowerfulTree);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('items', {});
    fixture.componentRef.setInput('rootIds', []);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
