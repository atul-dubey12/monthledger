package com.monthledger.entry;

import com.monthledger.category.Category;
import com.monthledger.category.CategoryRepository;
import com.monthledger.goal.Goal;
import com.monthledger.goal.GoalRepository;
import com.monthledger.recurring.Recurring;
import com.monthledger.recurring.RecurringRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/entries")
public class EntryController {
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("100000000");
    private static final LocalDate EARLIEST = LocalDate.of(2000, 1, 1);
    /** A budget month is at most 31 days; a year leaves room for history views without unbounded scans. */
    private static final int MAX_RANGE_DAYS = 400;
    private final EntryRepository entries;
    private final CategoryRepository categories;
    private final GoalRepository goals;
    private final RecurringRepository recurring;

    public EntryController(EntryRepository entries, CategoryRepository categories, GoalRepository goals, RecurringRepository recurring) {
        this.entries = entries;
        this.categories = categories;
        this.goals = goals;
        this.recurring = recurring;
    }

    /** Newest first. Both dates are inclusive. */
    @GetMapping
    public List<Entry> list(@RequestParam LocalDate from, @RequestParam LocalDate to) {
        if (to.isBefore(from)) throw bad("'to' must be on or after 'from'.");
        if (from.plusDays(MAX_RANGE_DAYS).isBefore(to)) throw bad("Ask for at most " + MAX_RANGE_DAYS + " days at a time.");
        return entries.findByDateBetweenOrderByDateDescIdDesc(from, to);
    }

    /** Backup as CSV, oldest first. Without dates it is everything. */
    @GetMapping(value = "/export", produces = "text/csv")
    public ResponseEntity<String> export(@RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        if (from != null && to != null && to.isBefore(from)) throw bad("'to' must be on or after 'from'.");
        LocalDate start = from == null ? LocalDate.of(1900, 1, 1) : from;
        LocalDate end = to == null ? LocalDate.of(9999, 12, 31) : to;
        List<Entry> list = new ArrayList<>(entries.findByDateBetweenOrderByDateDescIdDesc(start, end));
        list.sort(Comparator.comparing(Entry::getDate).thenComparing(Entry::getId));
        String csv = EntryCsv.write(list,
            categories.findAll().stream().collect(Collectors.toMap(Category::getId, Function.identity())),
            goals.findAll().stream().collect(Collectors.toMap(Goal::getId, Function.identity())),
            recurring.findAll().stream().collect(Collectors.toMap(Recurring::getId, Function.identity())));
        String name = from == null && to == null ? "monthledger-all-" + LocalDate.now() + ".csv" : "monthledger-" + start + "-to-" + end + ".csv";
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
            .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
            .body(csv);
    }

    /** One CSV row after the app matched its category and goal names. `row` is the line in the file, for messages. */
    public record ImportEntry(Integer row, LocalDate date, EntryKind kind, BigDecimal amount, Long categoryId, PaymentMode paymentMode, String note, Long goalId) {
        EntryRequest toRequest() { return new EntryRequest(date, kind, amount, categoryId, paymentMode, note, goalId, null); }
    }
    public record ImportRequest(List<ImportEntry> entries, boolean dryRun) {}
    public record ImportError(int row, String message) {}
    public record ImportResult(int imported, int duplicates, List<ImportError> errors) {}

    /**
     * Checks every row and skips ones already saved (same date, kind, category, amount, payment and note).
     * A row repeated in the file is kept as often as it appears beyond what's saved, so two ₹40 teas on
     * one day both survive. With dryRun nothing is written; otherwise all valid new rows are saved
     * oldest first, or none of them if anything fails.
     */
    @PostMapping("/import")
    @Transactional
    public ImportResult importEntries(@RequestBody ImportRequest request) {
        if (request.entries() == null) throw bad("Nothing to import.");
        if (request.entries().size() > 5000) throw bad("Import at most 5,000 rows at a time.");
        Map<String, Integer> saved = new HashMap<>();
        for (Entry e : entries.findAll()) saved.merge(key(e.getDate(), e.getKind(), e.getCategoryId(), e.getAmount(), e.getPaymentMode(), e.getNote()), 1, Integer::sum);
        List<ImportError> errors = new ArrayList<>();
        List<ImportEntry> fresh = new ArrayList<>();
        int duplicates = 0;
        for (int i = 0; i < request.entries().size(); i++) {
            ImportEntry row = request.entries().get(i);
            int line = row.row() == null ? i + 1 : row.row();
            try {
                validate(row.toRequest(), null, true);
            } catch (ResponseStatusException ex) {
                errors.add(new ImportError(line, ex.getReason()));
                continue;
            }
            String note = row.note() == null || row.note().isBlank() ? null : row.note().trim();
            String k = key(row.date(), row.kind(), row.categoryId(), row.amount(), row.paymentMode(), note);
            int left = saved.getOrDefault(k, 0);
            if (left > 0) { saved.put(k, left - 1); duplicates++; continue; }
            fresh.add(row);
        }
        if (!request.dryRun()) {
            fresh.sort(Comparator.comparing(ImportEntry::date));   // stable: keeps file order within a day
            for (ImportEntry row : fresh) {
                Entry entry = new Entry();
                apply(entry, row.toRequest());
                entries.save(entry);
            }
        }
        return new ImportResult(fresh.size(), duplicates, errors);
    }

    private static String key(LocalDate date, EntryKind kind, Long categoryId, BigDecimal amount, PaymentMode mode, String note) {
        return date + "|" + kind + "|" + categoryId + "|" + amount.stripTrailingZeros().toPlainString() + "|" + Objects.toString(mode, "") + "|" + Objects.toString(note, "");
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Entry create(@RequestBody EntryRequest request) {
        validate(request, null);
        Entry entry = new Entry();
        apply(entry, request);
        return entries.save(entry);
    }

    @PutMapping("/{id}")
    public Entry update(@PathVariable Long id, @RequestBody EntryRequest request) {
        Entry entry = entries.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "This entry no longer exists."));
        validate(request, entry);
        apply(entry, request);
        return entries.save(entry);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        if (!entries.existsById(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This entry no longer exists.");
        entries.deleteById(id);
    }

    private void apply(Entry entry, EntryRequest request) {
        entry.setDate(request.date());
        entry.setKind(request.kind());
        entry.setAmount(request.amount());
        entry.setCategoryId(request.categoryId());
        entry.setPaymentMode(request.paymentMode());
        String note = request.note() == null ? null : request.note().trim();
        entry.setNote(note == null || note.isEmpty() ? null : note);
        entry.setGoalId(request.goalId());
        entry.setRecurringId(request.recurringId());
    }

    private void validate(EntryRequest request, Entry existing) { validate(request, existing, false); }

    /** allowHidden: restoring a backup may use categories and goals that were hidden since. */
    private void validate(EntryRequest request, Entry existing, boolean allowHidden) {
        if (request.kind() == null) throw bad("Choose income, expense or saving.");
        BigDecimal amount = request.amount();
        if (amount == null || amount.signum() <= 0) throw bad("Enter an amount greater than ₹0.");
        if (amount.compareTo(MAX_AMOUNT) > 0) throw bad("That amount is too large.");
        if (amount.stripTrailingZeros().scale() > 2) throw bad("Amounts can have at most 2 decimal places (paise).");
        if (request.date() == null) throw bad("Pick a date.");
        if (request.date().isBefore(EARLIEST)) throw bad("That date is too far in the past.");
        if (request.date().isAfter(LocalDate.now().plusYears(1))) throw bad("That date is too far in the future.");
        if (request.note() != null && request.note().trim().length() > 180) throw bad("Notes can be up to 180 characters.");
        if (request.categoryId() == null) throw bad("Pick a category.");
        Category category = categories.findById(request.categoryId()).orElseThrow(() -> bad("That category no longer exists."));
        // An archived category is fine on an entry that already used it, but not for new money.
        boolean keepsOldCategory = existing != null && existing.getCategoryId().equals(category.getId());
        if (category.isArchived() && !keepsOldCategory && !allowHidden) throw bad("That category is archived. Pick another one.");
        if (!request.kind().allows(category.getBucket())) throw bad(category.getName() + " can't be used for this kind of entry.");
        if (request.goalId() != null) {
            if (request.kind() != EntryKind.SAVING && request.kind() != EntryKind.SAVING_WITHDRAWAL) throw bad("Only savings can count towards a goal.");
            Goal goal = goals.findById(request.goalId()).orElseThrow(() -> bad("That goal no longer exists."));
            boolean keepsOldGoal = existing != null && request.goalId().equals(existing.getGoalId());
            if (goal.isArchived() && !keepsOldGoal && !allowHidden) throw bad("That goal is hidden. Pick another one.");
        }
        if (request.recurringId() != null) {
            Recurring item = recurring.findById(request.recurringId()).orElseThrow(() -> bad("That monthly item no longer exists."));
            // A withdrawal never "pays" a monthly saving; otherwise the entry must be the same kind as the item.
            if (item.getKind() != request.kind()) throw bad("This entry doesn't match the monthly item it's paying.");
        }
    }

    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
