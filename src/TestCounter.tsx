import { useEffect, useRef, useState } from 'react';
import Decimal from 'break_infinity.js';

// Phase-0-Sanity-Check: belegt, dass break_infinity.js eingebunden ist und
// mit groesseren Zahlen rechnet. Wird in Phase 1 durch EconomyStore ersetzt.
export function TestCounter() {
    const countRef = useRef(new Decimal(0));
    const [display, setDisplay] = useState(countRef.current.toString());

    useEffect(() => {
        const id = setInterval(() => {
            countRef.current = countRef.current.plus(1).times(1.01);
            setDisplay(countRef.current.toString());
        }, 100);

        return () => clearInterval(id);
    }, []);

    return (
        <div className="testCounter">
            Test-Zaehler (break_infinity.js):
            <pre>{display}</pre>
        </div>
    );
}
