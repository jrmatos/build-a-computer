import { useMemo } from 'react';
import { t } from '../../../i18n';
import { rv } from '../../../sim/client';
import { hex32 } from '../rv';
import { parseFs } from './fs';
import type { KernelSnapshot } from './gather';
import type { KernelModel } from './kernel';
import { useLive } from './useKernel';

/** Most of the disk the view reads (1 MiB: every Phase 9 disk). */
const MAX_SECTORS = 2048;

/** The file system on the block device: superblock, root directory and inodes, with which process has what open. */
export function FilesView({ model, snap }: { model: KernelModel; snap: KernelSnapshot | undefined }) {
  // The kernel only reads the disk: once per load and stop is plenty.
  const disk = useLive(() => rv.disk(0, MAX_SECTORS), [], false);
  const fs = useMemo(() => (disk ? parseFs(model.header, disk) : null), [disk, model]);
  if (!fs) return <p className="dk-empty">{t('os.reading')}</p>;
  if (fs.problem) return <p className="dk-empty">{t(`os.fs.${fs.problem}`)}</p>;
  const sb = fs.sb!;
  const openers = (inum: number): string[] =>
    (snap?.procs ?? []).filter((p) => p.state && p.files?.some((f) => f.inum === inum)).map((p) => String(p.pid));

  return (
    <div className="os-split">
      <div className="os-scroll">
        <table className="os-table" aria-label={t('os.fs.root')}>
          <thead>
            <tr>
              <th scope="col">{t('os.fs.name')}</th>
              <th scope="col">{t('os.fs.inum')}</th>
              <th scope="col">{t('os.fs.type')}</th>
              <th scope="col">{t('os.fs.size')}</th>
              <th scope="col">{t('os.fs.sectors')}</th>
              <th scope="col">{t('os.fs.open')}</th>
            </tr>
          </thead>
          <tbody>
            {fs.root.map((e) => {
              const node = fs.inodes.find((n) => n.inum === e.inum);
              const s = node?.sectors ?? [];
              const by = openers(e.inum);
              return (
                <tr key={e.inum} className="os-row">
                  <td className="os-name">{e.name}</td>
                  <td>{e.inum}</td>
                  <td>{t(`os.fs.t${e.type}`)}</td>
                  <td className="dk-readout">{e.size}</td>
                  <td className="dk-readout">
                    {s.length ? (s.length > 1 ? `${s[0]}–${s[s.length - 1]}` : s[0]) : '—'}
                    {node?.indirect !== undefined && ` ${t('os.fs.indirect', { s: node.indirect })}`}
                  </td>
                  <td className="dk-readout">{by.length ? t('os.fs.openBy', { pids: by.join(', ') }) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="os-detail">
        <h3 className="dk-cpu-label">{t('os.fs.super')}</h3>
        <dl className="os-kv">
          <div>
            <dt>magic</dt>
            <dd>
              <code>0x{hex32(sb.magic)}</code>
            </dd>
          </div>
          <div>
            <dt>nsectors</dt>
            <dd>{sb.nsectors}</dd>
          </div>
          <div>
            <dt>ninodes</dt>
            <dd>{t('os.fs.inodesUsed', { used: fs.inodes.length, n: sb.ninodes })}</dd>
          </div>
          <div>
            <dt>inodestart</dt>
            <dd>{sb.inodestart}</dd>
          </div>
          <div>
            <dt>datastart</dt>
            <dd>{sb.datastart}</dd>
          </div>
        </dl>
        {fs.boot && (
          <>
            <h3 className="dk-cpu-label">{t('os.fs.boot')}</h3>
            <p className="os-note">{t('os.fs.bootInfo', { size: fs.boot.size, start: fs.boot.start, load: hex32(fs.boot.load), entry: hex32(fs.boot.entry) })}</p>
          </>
        )}
      </div>
    </div>
  );
}
