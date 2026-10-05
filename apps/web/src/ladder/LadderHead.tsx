import type { ReactNode } from 'react';
import './LadderHead.css';

/** The ladder's heading, standing alone with no places beside it. */
export function LadderHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
    return (
        <div className="ladder-head">
            <div className="ladder-head-row">
                <h1 className="screen-title">{title}</h1>
            </div>
            {children}
        </div>
    );
}
