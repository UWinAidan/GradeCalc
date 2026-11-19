// Demo gradebook: a made-up student with made-up DEMO-xxxx courses and marks. Shows most features at once:
// two finished terms and one in progress, a repeated course, pass/fail, nested components, drop lowest, a bonus,
// "final replaces the midterm", points and letter-only marks, an excused item.
export function demoDoc() {
  let id = 0;
  const d = { schema: 1, terms: [], courses: [], components: [], assessments: [], repeats: [],
    settings: { gpa_scale: 'uwindsor', custom_scale: null, repeat_policy_default: 'best', default_credits: 3 }, audit: [] };
  const term = (name, season, year, yos) => { const t = { id: ++id, name, season, year, year_of_study: yos, sort_order: d.terms.length + 1 }; d.terms.push(t); return t; };
  const course = (t, code, title, extra = {}) => {
    const c = { id: ++id, term_id: t.id, code, title, credits: 3, type: 'graded', status: 'active', sort_order: d.courses.filter((x) => x.term_id === t.id).length + 1, ...extra };
    d.courses.push(c); return c;
  };
  const comp = (c, name, weight, extra = {}) => {
    const k = { id: ++id, course_id: c.id, name, weight, sort_order: d.components.filter((x) => x.course_id === c.id).length + 1, ...extra };
    d.components.push(k); return k;
  };
  // marks: numbers are % (out of 1) unless [points, out_of]; a string is a letter; null = not marked yet
  const items = (k, base, marks, extra = {}) => marks.forEach((m, i) => {
    const a = { id: ++id, component_id: k.id, name: marks.length === 1 ? base : `${base} ${i + 1}`, out_of: 1, mark: null, letter: null, sort_order: i + 1, ...extra };
    if (Array.isArray(m)) { a.mark = m[0]; a.out_of = m[1]; } else if (typeof m === 'string') a.letter = m; else if (m !== null) a.mark = m / 100;
    d.assessments.push(a);
  });

  const t1 = term('Fall 2025', 'Fall', 2025, 1);
  const t2 = term('Winter 2026', 'Winter', 2026, 1);
  const t3 = term('Fall 2026', 'Fall', 2026, 2);

  // ---- Fall 2025 (finished)
  let c = course(t1, 'DEMO-1010', 'Calculus I', { status: 'complete' });
  items(comp(c, 'Assignments', 20, { drop_so_far: 1, drop_average: 1 }), 'Assignment', [72, 65, 40, 70, 68]);
  items(comp(c, 'Midterm', 30), 'Midterm', [55]);
  items(comp(c, 'Final exam', 50), 'Final exam', [58]);
  const calc1 = c;
  c = course(t1, 'DEMO-1100', 'Academic Writing', { status: 'complete' });
  items(comp(c, 'Essays', 60), 'Essay', [81, 'B+', 88]);
  items(comp(c, 'Participation', 10), 'Participation', [95]);
  items(comp(c, 'Portfolio', 30), 'Portfolio', [84]);
  c = course(t1, 'DEMO-1200', 'Intro to Programming', { status: 'complete' });
  const labs = comp(c, 'Labs', 30, { rule: null });
  items(comp(c, 'Lab reports', 2, { parent_id: labs.id }), 'Report', [[18, 20], [17, 20], [19, 20], [20, 20]]);
  items(comp(c, 'Lab quizzes', 1, { parent_id: labs.id }), 'Quiz', [[8, 10], [9, 10], [7, 10]]);
  items(comp(c, 'Project', 30), 'Project', [91]);
  items(comp(c, 'Final exam', 40), 'Final exam', [83]);
  items(comp(c, 'Bonus challenge', 3, { is_bonus: 1 }), 'Challenge', [100]);
  c = course(t1, 'DEMO-1300', 'First-Year Seminar', { type: 'pass_fail', pass_result: 'pass', credits: 1, status: 'complete' });

  // ---- Winter 2026 (finished)
  c = course(t2, 'DEMO-1020', 'Calculus II', { status: 'complete' });
  items(comp(c, 'Quizzes', 15, { drop_so_far: 1, drop_average: 1 }), 'Quiz', [80, 74, 90, 85]);
  const mid = comp(c, 'Midterm', 35);
  items(mid, 'Midterm', [69]);
  items(comp(c, 'Final exam', 50, { rule: { type: 'absorb_if_higher', from: [mid.id] } }), 'Final exam', [77]);
  c = course(t2, 'DEMO-1400', 'Intro to Psychology', { status: 'complete' });
  items(comp(c, 'Tests', 60), 'Test', [86, 79]);
  items(comp(c, 'Research credits', 10), 'Credit', [100]);
  items(comp(c, 'Final exam', 30), 'Final exam', [82]);
  c = course(t2, 'DEMO-1210', 'Data Structures', { status: 'complete', final_override: 0.84, notes: 'Final grade from the transcript.' });
  items(comp(c, 'Assignments', 40), 'Assignment', [85, 88, 79]);
  items(comp(c, 'Exam', 60), 'Exam', [81]);

  // ---- Fall 2026 (in progress)
  const retake = course(t3, 'DEMO-1010', 'Calculus I (retake)');
  items(comp(retake, 'Assignments', 20, { drop_so_far: 1, drop_average: 1 }), 'Assignment', [85, 90, 78, null, null]);
  items(comp(retake, 'Midterm', 30), 'Midterm', [76]);
  items(comp(retake, 'Final exam', 50), 'Final exam', [null]);
  d.repeats.push({ id: ++id, course_ids: [calc1.id, retake.id], policy: null });
  c = course(t3, 'DEMO-2100', 'Vectors and Matrices');
  const qz = comp(c, 'Quizzes', 20); // quiz 3 excused: its weight stays with the other quizzes
  items(qz, 'Quiz', [90, 85, null, null]);
  d.assessments[d.assessments.length - 2].excused = 1;
  items(comp(c, 'Midterm', 30, { rule: { type: 'min_warning', min: 0.5, label: 'Midterm min 50%' } }), 'Midterm', [[31, 40]]);
  items(comp(c, 'Final exam', 50), 'Final exam', [null]);
  c = course(t3, 'DEMO-2300', 'Data and Chance');
  items(comp(c, 'Homework', 25), 'Homework', [92, 88, null, null]);
  items(comp(c, 'Tests', 35), 'Test', [74, null]);
  items(comp(c, 'Final exam', 40), 'Final exam', [null]);
  c = course(t3, 'DEMO-2050', 'Transfer credit: Art History', { type: 'transfer', status: 'complete' });

  d.next_id = id + 1;
  return d;
}
