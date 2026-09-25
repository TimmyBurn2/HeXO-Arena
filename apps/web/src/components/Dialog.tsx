import { useEffect, useRef, type ReactNode } from 'react';
import './Dialog.css';

/**
 * A native modal dialog: the browser owns the focus trap, the escape
 * close, and background inertness; the backdrop click joins escape as the
 * two pointer-free ways out.
 */
export function Dialog({ open, onClose, label, children }: {
    open: boolean;
    onClose: () => void;
    label: string;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const element = ref.current;
        if (element === null) return;
        if (open && !element.open) {
            element.showModal();
        } else if (!open && element.open) {
            element.close();
        }
    }, [open]);

    return (
        <dialog
            ref={ref}
            className="dialog"
            aria-label={label}
            onClose={onClose}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            {/* the dialog lifts and the panel inside takes the cut, since
                the cut would clip the lift */}
            <div className="dialog-panel">{children}</div>
        </dialog>
    );
}
