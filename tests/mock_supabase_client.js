class MockQueryBuilder {
    constructor(table) {
        this.table = table;
        this.filters = [];
        this.isSingle = false;
    }

    select(cols = '*') {
        return this;
    }

    eq(col, val) {
        this.filters.push({ col, val });
        return this;
    }

    maybeSingle() {
        this.isSingle = true;
        return this;
    }

    then(resolve, reject) {
        let results = [...this.table.rows];
        for (const f of this.filters) {
            results = results.filter(r => r[f.col] === f.val);
        }
        if (this.isSingle) {
            resolve({ data: results[0] || null, error: null });
        } else {
            resolve({ data: results, error: null });
        }
    }
}

class MockDeleteBuilder {
    constructor(table) {
        this.table = table;
        this.filters = [];
    }

    eq(col, val) {
        this.filters.push({ col, val });
        return this;
    }

    then(resolve, reject) {
        this.table.rows = this.table.rows.filter(r => {
            return !this.filters.every(f => r[f.col] === f.val);
        });
        resolve({ data: [], error: null });
    }
}

class MockSupabaseTable {
    constructor(tableName) {
        this.tableName = tableName;
        this.rows = [];
    }

    select(cols = '*') {
        const builder = new MockQueryBuilder(this);
        return builder.select(cols);
    }

    delete() {
        return new MockDeleteBuilder(this);
    }

    async insert(itemOrList) {
        const items = Array.isArray(itemOrList) ? itemOrList : [itemOrList];
        for (const item of items) {
            this.rows.push({ id: `mock_${Date.now()}_${Math.random()}`, ...item });
        }
        return { data: items, error: null };
    }

    async upsert(itemOrList, options = {}) {
        const items = Array.isArray(itemOrList) ? itemOrList : [itemOrList];
        for (const item of items) {
            const conflictFields = (options.onConflict || '').split(',').map(s => s.trim()).filter(Boolean);
            let existingIdx = -1;
            if (conflictFields.length > 0) {
                existingIdx = this.rows.findIndex(r => conflictFields.every(f => r[f] === item[f]));
            }
            if (existingIdx >= 0) {
                this.rows[existingIdx] = { ...this.rows[existingIdx], ...item };
            } else {
                this.rows.push({ id: `mock_${Date.now()}_${Math.random()}`, ...item });
            }
        }
        return { data: items, error: null };
    }
}

class MockSupabaseClient {
    constructor(userId) {
        this.userId = userId;
        this.tables = {
            user_library: new MockSupabaseTable('user_library'),
            user_favorites: new MockSupabaseTable('user_favorites'),
            user_reading_progress: new MockSupabaseTable('user_reading_progress'),
            user_preferences: new MockSupabaseTable('user_preferences'),
            user_deletions: new MockSupabaseTable('user_deletions')
        };
    }

    from(tableName) {
        if (!this.tables[tableName]) {
            this.tables[tableName] = new MockSupabaseTable(tableName);
        }
        return this.tables[tableName];
    }
}

module.exports = { MockSupabaseClient };
