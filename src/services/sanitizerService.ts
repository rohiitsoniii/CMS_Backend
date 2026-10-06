import sanitizeHtml from 'sanitize-html';

/**
 * Sanitizer Service — XSS Protection for Content Data
 *
 * Recursively walks the content `data` object and strips dangerous HTML
 * from all string values. Safe HTML (bold, links, lists) is preserved.
 *
 * Applied as a pre-save hook on the Content model.
 */

// Allowed HTML tags & attributes for rich text fields
const ALLOWED_TAGS = [
    'a', 'b', 'i', 'u', 'em', 'strong', 'p', 'br', 'hr',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'figure', 'figcaption', 'span', 'div'
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
    'a': ['href', 'title', 'target', 'rel'],
    'img': ['src', 'alt', 'width', 'height', 'loading'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan'],
    '*': ['class', 'id', 'data-*'],
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // Explicitly disallow dangerous protocols in href
    allowedSchemesByTag: {
        'a': ['http', 'https', 'mailto', 'tel'],
        'img': ['http', 'https', 'data'],
    },
    // Force noopener noreferrer on external links
    transformTags: {
        'a': (tagName: string, attribs: sanitizeHtml.Attribs) => {
            if (attribs.href && attribs.href.startsWith('http')) {
                return {
                    tagName,
                    attribs: {
                        ...attribs,
                        rel: 'noopener noreferrer',
                        target: '_blank',
                    },
                };
            }
            return { tagName, attribs };
        },
    },
};

/**
 * Sanitize a single string value.
 */
export function sanitizeString(value: string): string {
    return sanitizeHtml(value, SANITIZE_OPTIONS);
}

/**
 * Recursively sanitize all string values in a data object.
 * Arrays, nested objects, and non-string primitives are all handled.
 */
export function sanitizeContentData(data: Record<string, any>): Record<string, any> {
    if (!data || typeof data !== 'object') return data;
    return sanitizeValue(data) as Record<string, any>;
}

function sanitizeValue(value: any): any {
    if (typeof value === 'string') {
        return sanitizeString(value);
    }

    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }

    if (value !== null && typeof value === 'object') {
        const sanitized: Record<string, any> = {};
        for (const [key, val] of Object.entries(value)) {
            sanitized[key] = sanitizeValue(val);
        }
        return sanitized;
    }

    // Numbers, booleans, null — return as-is
    return value;
}
