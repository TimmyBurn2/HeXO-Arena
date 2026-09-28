import tseslint from 'typescript-eslint';

// Names that carry words to a reader: the DOM's text attributes, and the
// props, object keys, and parameters of the site's own code that hold
// text to show or to read out.
const textName =
    /^(?:aria-(?:label|description|valuetext|roledescription|placeholder)|title|alt|placeholder|label|heading|sentence|note|failure|description|credit|text|message|caption|hint|summary|legend|children|author|copyright)$|(?:Label|Text|Title|Message|Note|Hint|Sentence)$/;

// Attributes that show their value only sometimes: a button's value, a
// field's default, a meta tag's content.
const sometimesText = /^(?:value|defaultValue|content)$/;

// Calls whose string arguments address the document or the platform
// rather than say anything.
const addressing =
    /^(?:querySelector|querySelectorAll|closest|matches|matchMedia|getPropertyValue|setProperty|addEventListener|removeEventListener|dispatchEvent|getAttribute|setAttribute|removeAttribute|hasAttribute|getElementById|test|exec|replace|replaceAll|split|join|startsWith|endsWith|includes|indexOf|padStart|padEnd|fetch|require)$/;

// Keys whose values are markup, style, or addresses, which hold several
// words that are not wording.
const markupKey = /class|selector|query|style|font|transform|path|url|href|src/i;

// Punctuation, whitespace, symbols, and numbers carry no wording, so only
// a letter makes a literal text.
const wording = /\p{L}/u;

// Letters and punctuation only, as two words or more, or one capitalized
// word, whatever spaces and punctuation stand at its ends: how a label or
// a phrase looks, and how an id, a path, or a piece of geometry never does.
const words = /^[\s,;:(]*(?:\p{Lu}\p{Ll}+|[\p{L}][\p{L}'-]*(?:[,;:]?\s+[\p{L}][\p{L}'-]*)+)[\s,;:.!?()]*$/u;

// A capitalized word, then more words with a lowercase one among them:
// a sentence or a label, wherever the literal sits.
const sentence = /^(?=[^]*\s\p{Ll})\p{Lu}[\p{L}\p{N}'-]*(?:[\s,;:.!?()_-]+["'(]?[\p{L}\p{N}][\p{L}\p{N}'"().-]*)+[\s.!?]*$/u;

// Marks a line whose literals are not words for a reader.
const exemption = /not ui text/;

// A call that reports to a developer: an assertion, a console, a logger.
function developerCall(node) {
    const callee = node.callee;
    if (callee.type === `Identifier`) return /^assert/.test(callee.name);
    return callee.type === `MemberExpression` && callee.object.type === `Identifier` && /^(?:console|logger|log|assert)$/.test(callee.object.name);
}

// A literal written straight into an attribute is judged by the
// attribute's name instead of its shape.
function attributeLiteral(node) {
    const holder = node.parent?.type === `JSXExpressionContainer` ? node.parent.parent : node.parent;
    return holder?.type === `JSXAttribute`;
}

// Messages for developers and module paths are not words for a reader.
function forDevelopers(node) {
    if (node.parent?.source === node) return true;
    for (let at = node.parent; at !== undefined && at !== null; at = at.parent) {
        if (at.type === `ThrowStatement`) return true;
        if (at.type === `NewExpression` && at.callee.type === `Identifier` && /(?:Error|Exception)$/.test(at.callee.name)) return true;
        if (at.type === `CallExpression` && developerCall(at)) return true;
    }
    return false;
}

/**
 * Every literal with wording in it that the site would show or read out:
 * JSX text, a text attribute or prop, the strings a JSX child or text
 * value can evaluate to, text-named object keys and parameters, words
 * given to a call, and literals shaped like labels or sentences wherever
 * they sit.
 * A string that is only compared or passed along never renders, so an
 * expression is followed only through the branches whose value shows.
 * A line marked "not ui text" in a comment on it or just above is skipped.
 */
export function findUiText(source, filePath) {
    const { ast, visitorKeys } = tseslint.parser.parseForESLint(source, {
        comment: true,
        ecmaFeatures: { jsx: true },
        filePath,
        loc: true,
        range: true,
    });
    const found = new Map();
    const constants = new Map();
    const exempt = new Set();
    for (const comment of ast.comments ?? []) {
        if (exemption.test(comment.value)) {
            exempt.add(comment.loc.end.line);
            exempt.add(comment.loc.end.line + 1);
        }
    }

    function report(node, value) {
        if (exempt.has(node.loc.start.line)) return;
        const key = node.range.join(`:`);
        if (!found.has(key)) found.set(key, { line: node.loc.start.line, column: node.loc.start.column + 1, text: value.trim() });
    }

    // The string values an expression can produce as it stands; `shape`
    // decides which of them count as text.
    function rendered(node, shape = wording, seen = new Set()) {
        if (node === null || node === undefined) return;
        switch (node.type) {
            case `Literal`:
                if (typeof node.value === `string` && shape.test(node.value)) report(node, node.value);
                return;
            case `TemplateLiteral`:
                for (const quasi of node.quasis) {
                    if (shape.test(quasi.value.cooked ?? ``)) report(quasi, quasi.value.cooked ?? ``);
                }
                for (const expression of node.expressions) rendered(expression, shape, seen);
                return;
            case `ConditionalExpression`:
                rendered(node.consequent, shape, seen);
                rendered(node.alternate, shape, seen);
                return;
            case `LogicalExpression`:
                // A string left of && renders only when empty.
                if (node.operator !== `&&`) rendered(node.left, shape, seen);
                rendered(node.right, shape, seen);
                return;
            case `BinaryExpression`:
                if (node.operator === `+`) {
                    rendered(node.left, shape, seen);
                    rendered(node.right, shape, seen);
                }
                return;
            case `ArrayExpression`:
                for (const element of node.elements) rendered(element, shape, seen);
                return;
            case `Identifier`: {
                const init = constants.get(node.name);
                if (init !== undefined && !seen.has(node.name)) rendered(init, shape, new Set([...seen, node.name]));
                return;
            }
            case `TSAsExpression`:
            case `TSNonNullExpression`:
            case `TSSatisfiesExpression`:
                rendered(node.expression, shape, seen);
                return;
            default:
                return;
        }
    }

    function attributeName(node) {
        return node.name.type === `JSXIdentifier` ? node.name.name : `${node.name.namespace.name}:${node.name.name.name}`;
    }

    function keyName(node) {
        if (node.computed) return null;
        if (node.key.type === `Identifier`) return node.key.name;
        if (node.key.type === `Literal` && typeof node.key.value === `string`) return node.key.value;
        return null;
    }

    function attributeValue(node) {
        if (node.value?.type === `Literal`) return node.value;
        if (node.value?.type === `JSXExpressionContainer`) return node.value.expression;
        return null;
    }

    function calleeName(node) {
        if (node.callee.type === `Identifier`) return node.callee.name;
        if (node.callee.type === `MemberExpression` && node.callee.property.type === `Identifier`) return node.callee.property.name;
        return null;
    }

    function collect(node) {
        if (node.type === `VariableDeclarator` && node.id.type === `Identifier` && node.init !== null) {
            if ([`Literal`, `TemplateLiteral`, `ArrayExpression`, `ConditionalExpression`, `BinaryExpression`].includes(node.init.type)) {
                constants.set(node.id.name, node.init);
            }
        }
        for (const key of visitorKeys[node.type] ?? []) {
            const child = node[key];
            for (const each of Array.isArray(child) ? child : [child]) {
                if (each !== null && typeof each === `object` && typeof each.type === `string`) collect(each);
            }
        }
    }

    function visit(node, parent) {
        node.parent = parent;
        switch (node.type) {
            case `JSXText`:
                if (wording.test(node.value)) report(node, node.value);
                break;
            case `JSXExpressionContainer`:
                if (parent?.type === `JSXElement` || parent?.type === `JSXFragment`) rendered(node.expression);
                break;
            case `JSXAttribute`: {
                const name = attributeName(node);
                const value = attributeValue(node);
                const component = parent?.name?.type === `JSXIdentifier` && /^[A-Z]/.test(parent.name.name);
                if (textName.test(name)) rendered(value);
                else if (sometimesText.test(name) || (component && name !== `className`)) rendered(value, words);
                break;
            }
            case `Property`:
                if (parent?.type === `ObjectExpression`) {
                    const key = keyName(node) ?? ``;
                    if (textName.test(key)) rendered(node.value);
                    else if (!markupKey.test(key)) rendered(node.value, words);
                }
                break;
            case `ReturnStatement`:
                rendered(node.argument, words);
                break;
            case `ArrowFunctionExpression`:
                if (node.expression) rendered(node.body, words);
                break;
            case `TaggedTemplateExpression`:
                rendered(node.quasi, words);
                break;
            case `ArrayExpression`:
                rendered(node, words);
                break;
            case `AssignmentPattern`:
                if (node.left.type === `Identifier` && textName.test(node.left.name)) rendered(node.right);
                break;
            case `CallExpression`:
                if (!addressing.test(calleeName(node) ?? ``) && !developerCall(node) && !forDevelopers(node)) {
                    for (const argument of node.arguments) rendered(argument, words);
                }
                break;
            case `Literal`:
                if (typeof node.value === `string` && sentence.test(node.value) && !attributeLiteral(node) && !forDevelopers(node)) {
                    report(node, node.value);
                }
                break;
            case `TemplateElement`:
                if (sentence.test(node.value.cooked ?? ``) && !forDevelopers(node)) report(node, node.value.cooked ?? ``);
                break;
            default:
                break;
        }
        for (const key of visitorKeys[node.type] ?? []) {
            const child = node[key];
            for (const each of Array.isArray(child) ? child : [child]) {
                if (each !== null && typeof each === `object` && typeof each.type === `string`) visit(each, node);
            }
        }
    }

    collect(ast);
    visit(ast, null);
    return [...found.values()].filter((hit) => hit.text !== ``).sort((a, b) => a.line - b.line || a.column - b.column);
}
